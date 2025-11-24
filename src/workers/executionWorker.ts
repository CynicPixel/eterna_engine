import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getQuotes, chooseBest } from '../services/dexRouter';
import { markOrderBuilding, markOrderSubmitted, finalizeOrderConfirmed, failOrder } from '../services/orderService';
import { WebSocketManager } from '../api/websocket/manager';
import { getOrder, updateOrderStatus } from '../db/repositories/orderRepo';
import { getRaydiumAdapter, getMeteoraAdapter } from '../adapters';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export async function startWorker() {
  const concurrency = Number(process.env.BULLMQ_CONCURRENCY || 10);
  const maxRetryAttempts = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
  
  const worker = new Worker(
    'orders',
    async (job: Job) => {
      const { orderId } = job.data as any;
      const currentAttempt = job.attemptsMade;
      
      try {
        const order = await getOrder(orderId);
        if (!order) throw new Error('order not found');

        // Update retry count in database
        await updateOrderStatus(orderId, { retry_count: currentAttempt });

        await WebSocketManager.sendStatus(orderId, { status: 'pending', retryCount: currentAttempt });

        const quotes = await getQuotes(order.token_in, order.token_out, Number(order.amount_in), Number(order.slippage || 0.01));
        await WebSocketManager.sendStatus(orderId, { status: 'routing', quotes, retryCount: currentAttempt });

        const chosen = chooseBest(quotes as any);
        await markOrderBuilding(orderId, chosen.dex);

        // execute via chosen adapter
        let execResult: any;
        if (chosen.dex === 'raydium') {
          const a = getRaydiumAdapter();
          execResult = await a.executeSwap({ tokenIn: order.token_in, tokenOut: order.token_out, amountIn: Number(order.amount_in), minAmountOut: chosen.amountOut * (1 - Number(order.slippage || 0.01)), userWallet: order.user_wallet });
        } else {
          const a = getMeteoraAdapter();
          execResult = await a.executeSwap({ tokenIn: order.token_in, tokenOut: order.token_out, amountIn: Number(order.amount_in), minAmountOut: chosen.amountOut * (1 - Number(order.slippage || 0.01)), userWallet: order.user_wallet });
        }

        await markOrderSubmitted(orderId, execResult.txHash);

        // simulate confirmation delay
        await new Promise((r) => setTimeout(r, 1000));

        await finalizeOrderConfirmed(orderId, execResult.txHash, execResult.executionPrice);
      } catch (err: any) {
        const attempts = job.attemptsMade;
        
        // If this was the last attempt, mark as failed permanently
        // BullMQ will not retry after maxRetryAttempts
        if (attempts >= maxRetryAttempts) {
          await failOrder(job.data.orderId, String(err), attempts);
          console.error(`Order ${job.data.orderId} failed after ${attempts} attempts: ${err.message}`);
        } else {
          console.warn(`Order ${job.data.orderId} attempt ${attempts} failed, will retry: ${err.message}`);
          // Update retry count but don't mark as failed yet
          await updateOrderStatus(job.data.orderId, { retry_count: attempts });
        }
        
        // Re-throw to trigger BullMQ retry mechanism
        throw err;
      }
    },
    { 
      connection, 
      concurrency,
      settings: {
        // BullMQ worker settings for retry
        backoffStrategy: (attemptsMade: number) => {
          // Exponential backoff: 1s, 2s, 4s
          return Math.pow(2, attemptsMade - 1) * 1000;
        }
      }
    }
  );

  worker.on('failed', (job, err) => {
    console.error('Job failed', job?.id, 'attemptsMade:', job?.attemptsMade, 'error:', err?.message);
  });

  worker.on('completed', (job) => {
    console.log('Job completed', job.id);
  });
  
  return worker;
}
