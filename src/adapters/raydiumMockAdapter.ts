import { DexQuote } from '../types';

export class RaydiumMockAdapter {
  name = 'raydium';

  async getQuote(params: { tokenIn: string; tokenOut: string; amountIn: number; slippage: number }): Promise<DexQuote> {
    // Mock implementation: return amountOut with small random variance
    const amountOut = params.amountIn * (Math.random() * 0.02 + 9.8); // fake conversion
    return {
      dex: this.name,
      amountOut,
      priceImpact: 0.002,
      fee: 0.003,
      poolAddress: 'raydium-pool-mock',
    };
  }

  async executeSwap(params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number; userWallet: any }) {
    // Mock execute: pretend to submit tx and return fake hash
    const txHash = 'raydium_tx_' + Math.random().toString(36).slice(2, 10);
    const executionPrice = params.minAmountOut / params.amountIn;
    return { txHash, executionPrice };
  }
}
