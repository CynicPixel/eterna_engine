import { DexQuote } from '../types';
import { RaydiumAdapter, MeteoraAdapter } from '../adapters';

const raydium = new RaydiumAdapter();
const meteora = new MeteoraAdapter();

export async function getQuotes(tokenIn: string, tokenOut: string, amountIn: number, slippage: number) {
  const [r, m] = await Promise.all([
    raydium.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
    meteora.getQuote({ tokenIn, tokenOut, amountIn, slippage }),
  ]);
  return [r, m];
}

export function chooseBest(quotes: DexQuote[]) {
  // choose larger amountOut
  return quotes.reduce((best, q) => (q.amountOut > best.amountOut ? q : best), quotes[0]);
}
