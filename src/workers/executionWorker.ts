import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getQuotes, chooseBest } from '../services/dexRouter';
import { markOrderBuilding, markOrderSubmitted, finalizeOrderConfirmed, failOrder } from '../services/orderService';
import { WebSocketManager } from '../api/websocket/manager';
import { getOrder, updateOrderStatus } from '../db/repositories/orderRepo';
import { getRaydiumAdapter, getMeteoraAdapter } from '../adapters';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
let sharedConnection: IORedis | null = null;

function getConnection(): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export async function startWorker() {
  const concurrency = Number(process.env.BULLMQ_CONCURRENCY || 10);
  const maxRetryAttempts = Number(process.env.MAX_RETRY_ATTEMPTS || 3);
  const connection = getConnection();
  
  const worker = new Worker(
    'orders',
    async (job: Job) => {
      const { orderId } = job.data as any;
      const currentAttempt = job.attemptsMade ?? 0;
      console.log(`[worker] processing order ${orderId} attempt ${currentAttempt}`);
      
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
        const attemptsMade = job.attemptsMade ?? 0;
        const willBeFinalAttempt = attemptsMade + 1 >= maxRetryAttempts;
        
        // Better error serialization
        const errorMsg = err?.message || err?.toString() || JSON.stringify(err) || 'Unknown error';
        console.error(`[worker] Error details:`, err);

        if (willBeFinalAttempt) {
          // Mark as failed permanently and notify clients
          await failOrder(job.data.orderId, errorMsg, attemptsMade + 1);
          console.error(`Order ${job.data.orderId} failed finally after ${attemptsMade + 1} attempts: ${errorMsg}`);
          // Do not re-throw because we've handled final failure
          return;
        }

        // Not final yet: increment retry_count in DB and rethrow to let BullMQ retry
        console.warn(`Order ${job.data.orderId} attempt ${attemptsMade + 1} failed, will retry: ${errorMsg}`);
        await updateOrderStatus(job.data.orderId, { retry_count: attemptsMade + 1 });
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
  
  await worker.waitUntilReady();
  return worker;
}

export async function stopWorker(worker?: Worker | null) {
  if (worker) {
    await worker.close();
  }
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}
