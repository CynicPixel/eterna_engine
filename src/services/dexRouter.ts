import { DexQuote } from '../types';
import { getRaydiumAdapter, getMeteoraAdapter } from '../adapters';

const raydium = getRaydiumAdapter();
const meteora = getMeteoraAdapter();

export async function getQuotes(tokenIn: string, tokenOut: string, amountIn: number, slippage: number) {
  const [r, m] = await Promise.all([
    raydium.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
    meteora.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
  ]);
  return [r, m];
}

export function chooseBest(quotes: DexQuote[]) {
  if (quotes.length === 0) {
    throw new Error('No quotes available to choose from');
  }
  // choose larger amountOut
  return quotes.reduce((best, q) => (q.amountOut > best.amountOut ? q : best), quotes[0]);
}
