import { RaydiumAdapter } from './raydiumAdapter';
import { MeteoraAdapter } from './meteoraAdapter';
import { RaydiumMockAdapter } from './raydiumMockAdapter';
import { MeteoraMockAdapter } from './meteoraMockAdapter';

const DEX_MODE = process.env.DEX_MODE || 'mock';

export function getRaydiumAdapter() {
  if (DEX_MODE === 'real' || DEX_MODE === 'devnet') {
    return new RaydiumAdapter();
  }
  return new RaydiumMockAdapter();
}

export function getMeteoraAdapter() {
  if (DEX_MODE === 'real' || DEX_MODE === 'devnet') {
    return new MeteoraAdapter();
  }
  return new MeteoraMockAdapter();
}

// Export both real and mock for direct usage when needed
export { RaydiumAdapter, MeteoraAdapter, RaydiumMockAdapter, MeteoraMockAdapter };
