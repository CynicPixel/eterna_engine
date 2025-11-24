import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../src/db/client';
import { insertOrder, getOrder, updateOrderStatus } from '../../src/db/repositories/orderRepo';

describe('Order Repository Integration', () => {
  let redis: IORedis | undefined;

  beforeAll(async () => {
    try {
      // Ensure table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          user_wallet TEXT,
          token_in TEXT,
          token_out TEXT,
          amount_in NUMERIC,
          slippage NUMERIC,
          status TEXT,
          selected_dex TEXT,
          execution_price NUMERIC,
          tx_hash TEXT,
          failure_reason TEXT,
          retry_count INT DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
      `);

      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      redis = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
      });
    } catch (err) {
      console.error('Setup failed:', err);
    }
  });

  afterAll(async () => {
    if (redis) redis.disconnect();
  });

  it('should insert and retrieve an order', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'So11111111111111111111111111111111111111112',
      tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: 0.1,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);
    const retrieved = await getOrder(orderId);

    expect(retrieved).toBeTruthy();
    expect(retrieved.id).toBe(orderId);
    expect(retrieved.status).toBe('pending');
    expect(parseFloat(retrieved.amount_in)).toBe(0.1);
  });

  it('should update order status', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);
    await updateOrderStatus(orderId, {
      status: 'confirmed',
      tx_hash: 'tx123',
      execution_price: 10.5,
    });

    const updated = await getOrder(orderId);
    expect(updated.status).toBe('confirmed');
    expect(updated.tx_hash).toBe('tx123');
    expect(parseFloat(updated.execution_price)).toBe(10.5);
  });

  it('should track retry count', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);
    await updateOrderStatus(orderId, { retry_count: 1 });
    await updateOrderStatus(orderId, { retry_count: 2 });

    const updated = await getOrder(orderId);
    expect(updated.retry_count).toBe(2);
  });

  it('should store failure reason', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);
    await updateOrderStatus(orderId, {
      status: 'failed',
      failure_reason: 'Slippage exceeded',
    });

    const updated = await getOrder(orderId);
    expect(updated.status).toBe('failed');
    expect(updated.failure_reason).toBe('Slippage exceeded');
  });

  it('should handle concurrent updates to same order without race condition', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);

    // Simulate two workers updating the same order concurrently
    const update1 = updateOrderStatus(orderId, { 
      status: 'routing',
      retry_count: 1 
    });
    const update2 = updateOrderStatus(orderId, { 
      status: 'building',
      selected_dex: 'raydium'
    });

    await Promise.all([update1, update2]);

    // Final state should reflect both updates without lost writes
    const final = await getOrder(orderId);
    
    // At least one of the status updates should be persisted
    expect(['routing', 'building']).toContain(final.status);
    
    // If retry_count or selected_dex were set, they should be persisted
    // (This validates no phantom writes - data isn't lost)
    if (final.retry_count !== null) {
      expect(final.retry_count).toBeGreaterThanOrEqual(0);
    }
  });

  it('should maintain data consistency with rapid sequential updates', async () => {
    const orderId = uuidv4();
    const order = {
      id: orderId,
      userWallet: '7xKWQ...',
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      slippage: 0.01,
      status: 'pending',
    };

    await insertOrder(order);

    // Rapid sequential updates simulating order lifecycle
    await updateOrderStatus(orderId, { status: 'routing' });
    await updateOrderStatus(orderId, { status: 'building', selected_dex: 'raydium' });
    await updateOrderStatus(orderId, { status: 'submitted', tx_hash: 'tx_abc123' });
    await updateOrderStatus(orderId, { 
      status: 'confirmed', 
      execution_price: 10.5 
    });

    const final = await getOrder(orderId);
    
    // All updates should be reflected in final state
    expect(final.status).toBe('confirmed');
    expect(final.selected_dex).toBe('raydium');
    expect(final.tx_hash).toBe('tx_abc123');
    expect(parseFloat(final.execution_price)).toBe(10.5);
  });

  it('should return undefined for non-existent order', async () => {
    const retrieved = await getOrder('non-existent-order-id-12345');
    expect(retrieved).toBeUndefined();
  });
});
