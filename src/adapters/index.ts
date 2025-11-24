import { RaydiumAdapter } from './raydiumAdapter';
import { MeteoraAdapter } from './meteoraAdapter';
import { RaydiumMockAdapter } from './raydiumMockAdapter';
import { MeteoraMockAdapter } from './meteoraMockAdapter';

function useRealAdapters() {
  const mode = (process.env.DEX_MODE || 'mock').toLowerCase();
  return mode === 'real' || mode === 'devnet';
}

export function getRaydiumAdapter() {
  return useRealAdapters() ? new RaydiumAdapter() : new RaydiumMockAdapter();
}

export function getMeteoraAdapter() {
  return useRealAdapters() ? new MeteoraAdapter() : new MeteoraMockAdapter();
}

// Export both real and mock for direct usage when needed
export { RaydiumAdapter, MeteoraAdapter, RaydiumMockAdapter, MeteoraMockAdapter };
