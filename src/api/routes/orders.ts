import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketManager } from '../websocket/manager';
import { createOrder, failOrder } from '../../services/orderService';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { validateOrderPayload, ValidationError } from '../../utils/validation';

export default async function routes(fastify: FastifyInstance) {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('orders', { connection: redis });

  // Single endpoint handling both HTTP POST and WebSocket
  // POST for initial order submission, GET with Upgrade header for WebSocket
  
  // HTTP POST: Initial order submission
  // Returns orderId immediately, client can then upgrade to WebSocket for status updates
  fastify.post('/orders/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.body as any;
    
    try {
      // Validate payload before processing
      validateOrderPayload(payload);
      
      const orderId = uuidv4();
      await createOrder(orderId, payload);
      
      // Add job to queue with exponential backoff retry configuration
      // This satisfies: "Exponential back-off retry (≤3 attempts)"
      await queue.add('execute-order', { orderId }, {
        attempts: Number(process.env.MAX_RETRY_ATTEMPTS || 3),
        backoff: {
          type: 'exponential',
          delay: 1000, // Start with 1s delay, then 2s, 4s, etc.
        },
      });
      
      // Return orderId and WebSocket endpoint
      // Client can upgrade connection by making GET request to same endpoint with Upgrade header
      return reply.send({ 
        orderId, 
        websocket: `/api/orders/execute?orderId=${orderId}`,
        message: 'Connect to websocket endpoint with orderId to receive status updates'
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // GET with WebSocket upgrade: Status streaming
  // This endpoint handles WebSocket connections for order status updates
  // Satisfies: "Connection upgrades to WebSocket for status streaming"
  fastify.get('/orders/execute', { websocket: true }, (connection: any, req: any) => {
    const ws = (connection as any).socket ?? connection;
    
    // Extract orderId from query parameter
    const url = new URL(req.url, `http://${req.headers.host}`);
    const orderIdFromQuery = url.searchParams.get('orderId');
    
    if (orderIdFromQuery) {
      // Register existing order for status updates
      WebSocketManager.register(orderIdFromQuery, ws);
      ws.send(JSON.stringify({ 
        orderId: orderIdFromQuery, 
        status: 'connected',
        message: 'WebSocket connected, listening for order status updates'
      }));
    } else {
      // Legacy flow: client sends order payload as first message
      // This allows direct WebSocket submission without HTTP POST
      ws.on('message', async (message: any) => {
        let orderId: string | null = null;
        try {
          const data = JSON.parse(message.toString());
          
          // If data has orderId, just register (client reconnecting)
          if (data.orderId) {
            WebSocketManager.register(data.orderId, ws);
            ws.send(JSON.stringify({ 
              orderId: data.orderId,
              status: 'connected',
              message: 'Reconnected to existing order'
            }));
            return;
          }
          
          // Otherwise treat as new order payload
          validateOrderPayload(data);
          
          orderId = uuidv4();
          await createOrder(orderId, data);
          WebSocketManager.register(orderId, ws);
          
          // Add job with retry configuration
          await queue.add('execute-order', { orderId }, {
            attempts: Number(process.env.MAX_RETRY_ATTEMPTS || 3),
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          });
          
          ws.send(JSON.stringify({ orderId }));
        } catch (err) {
          if (err instanceof ValidationError) {
            ws.send(JSON.stringify({ 
              error: err.message,
              status: 'failed',
              failureReason: err.message
            }));
          } else {
            if (orderId) {
              await failOrder(orderId, String(err));
            }
            ws.send(JSON.stringify({ 
              error: String(err),
              ...(orderId && { orderId })
            }));
          }
        }
      });
    }
  });
}
