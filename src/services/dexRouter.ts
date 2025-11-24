import { DexQuote } from '../types';
import { getRaydiumAdapter, getMeteoraAdapter } from '../adapters';

export async function getQuotes(tokenIn: string, tokenOut: string, amountIn: number, slippage: number) {
  const raydium = getRaydiumAdapter();
  const meteora = getMeteoraAdapter();
  const adapters = [
    raydium.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
    meteora.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
  ];

  const settled = await Promise.allSettled(adapters);
  const quotes: DexQuote[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      quotes.push(result.value);
    } else {
      const adapterName = index === 0 ? 'raydium' : 'meteora';
      console.warn(`[dexRouter] ${adapterName} quote failed:`, result.reason?.message || result.reason);
    }
  });

  if (quotes.length === 0) {
    throw new Error('No quotes available to choose from');
  }

  return quotes;
}

export function chooseBest(quotes: DexQuote[]) {
  if (quotes.length === 0) {
    throw new Error('No quotes available to choose from');
  }
  // choose larger amountOut
  return quotes.reduce((best, q) => (q.amountOut > best.amountOut ? q : best), quotes[0]);
}
