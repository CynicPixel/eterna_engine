import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RaydiumAdapter } from '../../src/adapters/raydiumAdapter';
import { MeteoraAdapter } from '../../src/adapters/meteoraAdapter';

describe('Raydium Adapter', () => {
  let adapter: RaydiumAdapter;

  beforeAll(() => {
    adapter = new RaydiumAdapter();
  });

  it('should return a valid quote', async () => {
    const quote = await adapter.getQuote({
      tokenIn: 'So11111111111111111111111111111111111111112',
      tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: 0.1,
      slippage: 0.01,
    });

    expect(quote.dex).toBe('raydium');
    expect(quote.amountOut).toBeGreaterThan(0);
    expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    expect(quote.fee).toBeGreaterThanOrEqual(0);
    expect(quote.poolAddress).toBeTruthy();
  });

  it('should execute swap and return transaction hash', async () => {
    const result = await adapter.executeSwap({
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      minAmountOut: 0.95,
      userWallet: 'wallet123',
    });

    expect(result.txHash).toMatch(/^raydium_tx_/);
    expect(result.executionPrice).toBeGreaterThan(0);
  });

  it('should calculate execution price correctly', async () => {
    const result = await adapter.executeSwap({
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 10.0,
      minAmountOut: 95.0,
      userWallet: 'wallet123',
    });

    expect(result.executionPrice).toBe(9.5);
  });
});

describe('Meteora Adapter', () => {
  let adapter: MeteoraAdapter;

  beforeAll(() => {
    adapter = new MeteoraAdapter();
  });

  it('should return a valid quote', async () => {
    const quote = await adapter.getQuote({
      tokenIn: 'So11111111111111111111111111111111111111112',
      tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: 0.1,
      slippage: 0.01,
    });

    expect(quote.dex).toBe('meteora');
    expect(quote.amountOut).toBeGreaterThan(0);
    expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    expect(quote.fee).toBeGreaterThanOrEqual(0);
    expect(quote.poolAddress).toBeTruthy();
  });

  it('should execute swap and return transaction hash', async () => {
    const result = await adapter.executeSwap({
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 1.0,
      minAmountOut: 0.95,
      userWallet: 'wallet123',
    });

    expect(result.txHash).toMatch(/^meteora_tx_/);
    expect(result.executionPrice).toBeGreaterThan(0);
  });

  it('should handle different token amounts', async () => {
    const smallResult = await adapter.executeSwap({
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 0.01,
      minAmountOut: 0.009,
      userWallet: 'wallet123',
    });

    const largeResult = await adapter.executeSwap({
      tokenIn: 'token1',
      tokenOut: 'token2',
      amountIn: 100.0,
      minAmountOut: 95.0,
      userWallet: 'wallet123',
    });

    expect(smallResult.txHash).toBeTruthy();
    expect(largeResult.txHash).toBeTruthy();
    expect(smallResult.txHash).not.toBe(largeResult.txHash);
  });
});
