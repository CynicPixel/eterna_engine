import { FastifyInstance } from 'fastify';
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

  // WebSocket handler: client can open a WS and send the order payload as first message
  fastify.get('/orders/execute', { websocket: true }, (connection: any, req: any) => {
    const ws = (connection as any).socket ?? connection;
    ws.on('message', async (message: any) => {
      let orderId: string | null = null;
      try {
        const payload = JSON.parse(message.toString());
        
        // Validate payload BEFORE creating order
        validateOrderPayload(payload);
        
        orderId = uuidv4();
        await createOrder(orderId, payload);
        WebSocketManager.register(orderId, ws);
        // enqueue execution job
        await queue.add('execute-order', { orderId });
        ws.send(JSON.stringify({ orderId }));
      } catch (err) {
        if (err instanceof ValidationError) {
          // Send validation error immediately without creating order
          ws.send(JSON.stringify({ 
            error: err.message,
            status: 'failed',
            failureReason: err.message
          }));
        } else {
          // For other errors, try to fail the order if it was created
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
  });

  // HTTP POST fallback: returns orderId and instructs client to open WS to same endpoint
  fastify.post('/orders/execute', async (request, reply) => {
    const payload = request.body as any;
    
    try {
      // Validate payload before processing
      validateOrderPayload(payload);
      
      const orderId = uuidv4();
      await createOrder(orderId, payload);
      // enqueue job
      await queue.add('execute-order', { orderId });
      return reply.send({ orderId, websocket: '/api/orders/execute' });
    } catch (err) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
