import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getQuotes, chooseBest } from '../services/dexRouter';
import { markOrderBuilding, markOrderSubmitted, finalizeOrderConfirmed, failOrder } from '../services/orderService';
import { WebSocketManager } from '../api/websocket/manager';
import { getOrder, updateOrderStatus } from '../db/repositories/orderRepo';
import { RaydiumAdapter } from '../adapters/raydiumAdapter';
import { MeteoraAdapter } from '../adapters/meteoraAdapter';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export async function startWorker() {
  const concurrency = Number(process.env.BULLMQ_CONCURRENCY || 10);
  const worker = new Worker(
    'orders',
    async (job: Job) => {
      const { orderId } = job.data as any;
      try {
        const order = await getOrder(orderId);
        if (!order) throw new Error('order not found');

        WebSocketManager.sendStatus(orderId, { status: 'pending' });

        const quotes = await getQuotes(order.token_in, order.token_out, Number(order.amount_in), Number(order.slippage || 0.01));
        WebSocketManager.sendStatus(orderId, { status: 'routing', quotes });

        const chosen = chooseBest(quotes as any);
        await markOrderBuilding(orderId, chosen.dex);

        // execute via chosen adapter
        let execResult: any;
        if (chosen.dex === 'raydium') {
          const a = new RaydiumAdapter();
          execResult = await a.executeSwap({ tokenIn: order.token_in, tokenOut: order.token_out, amountIn: Number(order.amount_in), minAmountOut: chosen.amountOut * (1 - Number(order.slippage || 0.01)), userWallet: order.user_wallet });
        } else {
          const a = new MeteoraAdapter();
          execResult = await a.executeSwap({ tokenIn: order.token_in, tokenOut: order.token_out, amountIn: Number(order.amount_in), minAmountOut: chosen.amountOut * (1 - Number(order.slippage || 0.01)), userWallet: order.user_wallet });
        }

        await markOrderSubmitted(orderId, execResult.txHash);

        // simulate confirmation delay
        await new Promise((r) => setTimeout(r, 1000));

        await finalizeOrderConfirmed(orderId, execResult.txHash, execResult.executionPrice);
      } catch (err: any) {
        const attempts = job.attemptsMade || 0;
        if (attempts >= Number(process.env.MAX_RETRY_ATTEMPTS || 3) - 1) {
          await failOrder(job.data.orderId, String(err), attempts);
        }
        throw err;
      }
    },
    { connection, concurrency }
  );

  worker.on('failed', (job, err) => {
    console.error('Job failed', job?.id, err?.message);
  });

  worker.on('completed', (job) => {
    console.log('Job completed', job.id);
  });
}
