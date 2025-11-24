import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

let connection: Connection | null = null;
let wallet: Keypair | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, 'confirmed');
  }
  return connection;
}

export function getWallet(): Keypair {
  if (!wallet) {
    if (!PRIVATE_KEY) {
      throw new Error('WALLET_PRIVATE_KEY not configured in environment');
    }
    try {
      // Support both base58 and array format
      const secretKey = PRIVATE_KEY.startsWith('[')
        ? Uint8Array.from(JSON.parse(PRIVATE_KEY))
        : bs58.decode(PRIVATE_KEY);
      wallet = Keypair.fromSecretKey(secretKey);
    } catch (err) {
      throw new Error(`Failed to parse WALLET_PRIVATE_KEY: ${err}`);
    }
  }
  return wallet;
}

export function parsePublicKey(address: string): PublicKey {
  try {
    return new PublicKey(address);
  } catch (err) {
    throw new Error(`Invalid Solana address: ${address}`);
  }
}
