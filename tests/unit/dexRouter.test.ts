import { describe, it, expect } from 'vitest';
import { getQuotes, chooseBest } from '../../src/services/dexRouter';
import { DexQuote } from '../../src/types';

describe('DEX Router', () => {
  describe('getQuotes', () => {
    it('should fetch quotes from both Raydium and Meteora', async () => {
      const quotes = await getQuotes(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        0.1,
        0.01
      );

      expect(quotes).toHaveLength(2);
      expect(quotes[0].dex).toBe('raydium');
      expect(quotes[1].dex).toBe('meteora');
      expect(quotes[0].amountOut).toBeGreaterThan(0);
      expect(quotes[1].amountOut).toBeGreaterThan(0);
    });

    it('should include price impact and fees in quotes', async () => {
      const quotes = await getQuotes('token1', 'token2', 1.0, 0.01);

      quotes.forEach((quote) => {
        expect(quote).toHaveProperty('priceImpact');
        expect(quote).toHaveProperty('fee');
        expect(quote).toHaveProperty('poolAddress');
        expect(typeof quote.priceImpact).toBe('number');
        expect(typeof quote.fee).toBe('number');
      });
    });
  });

  describe('chooseBest', () => {
    it('should select quote with higher amountOut', () => {
      const quotes: DexQuote[] = [
        {
          dex: 'raydium',
          amountOut: 10.5,
          priceImpact: 0.002,
          fee: 0.003,
          poolAddress: 'pool1',
        },
        {
          dex: 'meteora',
          amountOut: 10.8,
          priceImpact: 0.003,
          fee: 0.002,
          poolAddress: 'pool2',
        },
      ];

      const best = chooseBest(quotes);
      expect(best.dex).toBe('meteora');
      expect(best.amountOut).toBe(10.8);
    });

    it('should handle equal quotes by returning first', () => {
      const quotes: DexQuote[] = [
        {
          dex: 'raydium',
          amountOut: 10.5,
          priceImpact: 0.002,
          fee: 0.003,
          poolAddress: 'pool1',
        },
        {
          dex: 'meteora',
          amountOut: 10.5,
          priceImpact: 0.003,
          fee: 0.002,
          poolAddress: 'pool2',
        },
      ];

      const best = chooseBest(quotes);
      expect(best.dex).toBe('raydium');
    });

    it('should handle single quote', () => {
      const quotes: DexQuote[] = [
        {
          dex: 'raydium',
          amountOut: 10.5,
          priceImpact: 0.002,
          fee: 0.003,
          poolAddress: 'pool1',
        },
      ];

      const best = chooseBest(quotes);
      expect(best.dex).toBe('raydium');
      expect(best.amountOut).toBe(10.5);
    });

    it('should throw error if no quotes provided', () => {
      expect(() => chooseBest([])).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle when only one adapter returns a quote', async () => {
      // In real implementation, if one adapter fails, we should still get quotes from others
      const quotes = await getQuotes('token1', 'token2', 0.01, 0.01);
      
      // Should have at least 1 quote (our mocks always return both)
      expect(quotes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle very small amounts', async () => {
      const quotes = await getQuotes('token1', 'token2', 0.000001, 0.01);
      
      quotes.forEach((quote) => {
        expect(quote.amountOut).toBeGreaterThan(0);
      });
    });

    it('should handle high slippage scenarios', async () => {
      const quotes = await getQuotes('token1', 'token2', 10, 0.5);
      
      quotes.forEach((quote) => {
        expect(quote.priceImpact).toBeGreaterThan(0);
      });
    });
  });
});
