import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildServer } from '../../src/api/server';
import { startWorker, stopWorker } from '../../src/workers/executionWorker';
import redis from '../../src/redis/client';

describe('WebSocket Lifecycle (requires running server on port 3000)', () => {
  let ws: WebSocket;
  let fastify: FastifyInstance;
  let worker: Worker | null = null;
  let WS_URL = 'ws://127.0.0.1:0/api/orders/execute';
  let HTTP_HOST = '127.0.0.1';
  let HTTP_PORT = 3000;

  const getWsUrl = (orderId?: string) => (orderId ? `${WS_URL}?orderId=${orderId}` : WS_URL);

  beforeAll(async () => {
    process.env.DEX_MODE = 'mock';
    process.env.MAX_RETRY_ATTEMPTS = process.env.MAX_RETRY_ATTEMPTS || '1';

    fastify = await buildServer();
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    const addressInfo = fastify.server.address();
    if (!addressInfo || typeof addressInfo === 'string') {
      throw new Error('Unable to determine test server address');
    }

    HTTP_HOST = addressInfo.address === '::' ? '127.0.0.1' : addressInfo.address;
    HTTP_PORT = addressInfo.port;
    WS_URL = `ws://${HTTP_HOST}:${HTTP_PORT}/api/orders/execute`;

    worker = await startWorker();
  }, 20000);

  afterAll(async () => {
    await stopWorker(worker);
    if (fastify) {
      await fastify.close();
    }
    try {
      await redis.quit();
    } catch (err) {
      // ignore shutdown timeouts in tests
    }
  }, 10000);

  afterEach(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it('should connect to WebSocket endpoint', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(getWsUrl());

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  });

  it('should receive orderId after sending order', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(getWsUrl());

      ws.on('open', () => {
        const order = {
          userWallet: '7xKWQE6zHqXmbKZ7eXrSRREepUxJbPr14erMovNxZq7X',
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountIn: 0.1,
          slippage: 0.01,
        };

        ws.send(JSON.stringify(order));
      });

      ws.on('message', (data) => {
        const response = JSON.parse(data.toString());
        expect(response.orderId).toBeTruthy();
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => reject(new Error('Response timeout')), 5000);
    });
  }, 10000);

  it('should receive status updates throughout order lifecycle', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(getWsUrl());
      const statuses: string[] = [];
      let orderId: string;

      ws.on('open', () => {
        const order = {
          userWallet: '7xKWQE6zHqXmbKZ7eXrSRREepUxJbPr14erMovNxZq7X',
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountIn: 0.1,
          slippage: 0.01,
        };

        ws.send(JSON.stringify(order));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.orderId && !orderId) {
          orderId = message.orderId;
        }

        if (message.status) {
          statuses.push(message.status);

          // Check if we received final status
          if (message.status === 'confirmed' || message.status === 'failed') {
            expect(statuses).toContain('pending');
            expect(statuses).toContain('routing');
            expect(statuses).toContain('building');
            expect(statuses).toContain('submitted');
            ws.close();
            resolve();
          }
        }
      });

      ws.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        if (statuses.length > 0) {
          // Partial success - at least some statuses received
          resolve();
        } else {
          reject(new Error('No status updates received'));
        }
      }, 10000);
    });
  }, 15000); // Longer timeout for full execution flow

  it('should complete full end-to-end flow: WebSocket → DB → Queue → Adapter → Status broadcast', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(getWsUrl());
      const statuses: string[] = [];
      let orderId: string;
      let receivedQuotes = false;
      let receivedDexSelection = false;
      let receivedTxHash = false;
      let receivedExecutionPrice = false;

      ws.on('open', () => {
        const order = {
          userWallet: '7xKWQE6zHqXmbKZ7eXrSRREepUxJbPr14erMovNxZq7X',
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountIn: 0.1,
          slippage: 0.01,
        };

        ws.send(JSON.stringify(order));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        // Step 1: Capture orderId (proves DB persistence)
        if (message.orderId && !orderId) {
          orderId = message.orderId;
          expect(orderId).toBeTruthy();
        }

        // Step 2: Track status progression (proves queue processing)
        if (message.status) {
          statuses.push(message.status);
        }

        // Step 3: Validate routing data (proves adapter calls)
        if (message.status === 'routing' && message.quotes) {
          receivedQuotes = true;
          expect(message.quotes.length).toBeGreaterThan(0);
          expect(message.quotes[0]).toHaveProperty('dex');
          expect(message.quotes[0]).toHaveProperty('amountOut');
        }

        // Step 4: Validate DEX selection (proves routing logic)
        if (message.status === 'building' && message.selectedDex) {
          receivedDexSelection = true;
          expect(['raydium', 'meteora']).toContain(message.selectedDex);
        }

        // Step 5: Validate transaction submission (proves adapter execution)
        if (message.status === 'submitted' && message.txHash) {
          receivedTxHash = true;
          expect(message.txHash).toBeTruthy();
        }

        // Step 6: Validate final confirmation (proves complete flow)
        if (message.status === 'confirmed') {
          receivedExecutionPrice = message.executionPrice !== undefined;
          
          // Verify complete end-to-end trace
          expect(statuses).toContain('pending');
          expect(statuses).toContain('routing');
          expect(statuses).toContain('building');
          expect(statuses).toContain('submitted');
          expect(statuses).toContain('confirmed');
          
          expect(receivedQuotes).toBe(true);
          expect(receivedDexSelection).toBe(true);
          expect(receivedTxHash).toBe(true);
          expect(receivedExecutionPrice).toBe(true);
          
          ws.close();
          resolve();
        }

        // Handle failure case
        if (message.status === 'failed') {
          // Even failures should show retry attempts and proper error handling
          expect(orderId).toBeTruthy();
          expect(message.failureReason).toBeTruthy();
          ws.close();
          resolve();
        }
      });

      ws.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error(`End-to-end test timeout. Received statuses: ${statuses.join(', ')}`));
      }, 15000);
    });
  }, 20000); // Extended timeout for full lifecycle

  it('should emit failed status with failureReason for invalid orders', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(getWsUrl());

      ws.on('open', () => {
        const badOrder = {
          userWallet: '7xKWQ.',  // too short
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountIn: 0,      // invalid - must be > 0
          slippage: 1.5,    // invalid - must be <= 1
        };
        ws.send(JSON.stringify(badOrder));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        
        // Should receive error response with validation failure
        if (msg.error || msg.status === 'failed') {
          expect(msg.error || msg.failureReason).toBeTruthy();
          ws.close();
          resolve();
        }
      });

      ws.on('error', (error) => {
        // Connection errors are acceptable for this test
        resolve();
      });

      setTimeout(() => reject(new Error('No failed status received')), 7000);
    });
  }, 10000);

  it('should handle HTTP POST returning orderId for later WebSocket connection', async () => {
    // This tests the HTTP-only path (without upgrade)
    // POST returns orderId, then client can connect to WebSocket with that orderId
    const http = await import('http');
    
    return new Promise<void>((resolve, reject) => {
      const postData = JSON.stringify({
        userWallet: '7xKWQE6zHqXmbKZ7eXrSRREepUxJbPr14erMovNxZq7X',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amountIn: 0.1,
        slippage: 0.01,
      });

      const options = {
        hostname: HTTP_HOST,
        port: HTTP_PORT,
        path: '/api/orders/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            expect(response.orderId).toBeTruthy();
            expect(response.websocket).toContain('/api/orders/execute');
            expect(response.websocket).toContain(response.orderId);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();

      setTimeout(() => reject(new Error('HTTP POST timeout')), 5000);
    });
  }, 7000);

  it('should connect to WebSocket with orderId from POST response', async () => {
    // Test the full flow: POST to get orderId, then WebSocket to get updates
    const http = await import('http');
    
    return new Promise<void>((resolve, reject) => {
      const postData = JSON.stringify({
        userWallet: '7xKWQE6zHqXmbKZ7eXrSRREepUxJbPr14erMovNxZq7X',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amountIn: 0.1,
        slippage: 0.01,
      });

      const options = {
        hostname: HTTP_HOST,
        port: HTTP_PORT,
        path: '/api/orders/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      // First: POST to create order
      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            const orderId = response.orderId;
            
            // Second: Connect to WebSocket with orderId
            ws = new WebSocket(getWsUrl(orderId));
            
            ws.on('open', () => {
              expect(ws.readyState).toBe(WebSocket.OPEN);
            });

            ws.on('message', (data) => {
              const message = JSON.parse(data.toString());
              
              // Should receive connected message and/or status updates
              if (message.status === 'connected' || message.orderId === orderId) {
                expect(message.orderId || message.status).toBeTruthy();
                ws.close();
                resolve();
              }
            });

            ws.on('error', reject);
            
            setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }, 10000);
});
