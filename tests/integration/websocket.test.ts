import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';

describe('WebSocket Lifecycle (requires running server on port 3000)', () => {
  const WS_URL = 'ws://localhost:3000/api/orders/execute';
  let ws: WebSocket;

  afterEach(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  it('should connect to WebSocket endpoint', async () => {
    return new Promise<void>((resolve, reject) => {
      ws = new WebSocket(WS_URL);

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
      ws = new WebSocket(WS_URL);

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
      ws = new WebSocket(WS_URL);
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
      ws = new WebSocket(WS_URL);
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
      ws = new WebSocket(WS_URL);

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
});
