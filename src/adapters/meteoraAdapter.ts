import { DexQuote } from '../types';
import AmmImpl, { DEVNET_POOL } from '@meteora-ag/dynamic-amm-sdk';
import { getConnection, getWallet, parsePublicKey } from '../utils/solana';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';

export class MeteoraAdapter {
  name = 'meteora';

  async getQuote(params: { tokenIn: string; tokenOut: string; amountIn: number; slippage: number }): Promise<DexQuote> {
    const connection = getConnection();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);
    
    // Find pool for this token pair from known devnet pools
    const poolAddress = this.findPoolAddress(params.tokenIn, params.tokenOut);
    
    if (!poolAddress) {
      throw new Error(`No Meteora pool found for pair ${params.tokenIn}/${params.tokenOut}`);
    }

    // Initialize AMM - cast connection to any to avoid version mismatch
    const amm = await AmmImpl.create(connection as any, poolAddress);
    
    // Pool state is available as a property
    const poolState = amm.poolState;
    
    // Determine token indices
    const isTokenAIn = mintIn.equals(poolState.tokenAMint);
    const inputDecimals = isTokenAIn ? amm.tokenAMint.decimals : amm.tokenBMint.decimals;
    const outputDecimals = isTokenAIn ? amm.tokenBMint.decimals : amm.tokenAMint.decimals;
    
    // Convert input amount to lamports
    const amountInLamports = new BN(Math.floor(params.amountIn * Math.pow(10, inputDecimals)));
    
    // Calculate swap quote using the built-in method
    const swapQuote = amm.getSwapQuote(
      mintIn,
      amountInLamports,
      params.slippage // Meteora expects decimal (0.01 = 1%)
    );

    if (!swapQuote) {
      throw new Error('Failed to calculate swap quote from Meteora');
    }

    // Convert output to token units
    const amountOut = new Decimal(swapQuote.swapOutAmount.toString())
      .div(Math.pow(10, outputDecimals))
      .toNumber();

    // Calculate price impact: (inAmount - outAmount) / inAmount
    const inValue = params.amountIn;
    const priceImpact = Math.abs((inValue - amountOut) / inValue);
    
    const fee = swapQuote.fee.toNumber() / amountInLamports.toNumber();

    return {
      dex: this.name,
      amountOut,
      priceImpact,
      fee,
      poolAddress: poolAddress.toBase58(),
    };
  }

  async executeSwap(params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number; userWallet: any }): Promise<{ txHash: string; executionPrice: number }> {
    const connection = getConnection();
    const wallet = getWallet();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);

    // Find pool
    const poolAddress = this.findPoolAddress(params.tokenIn, params.tokenOut);
    
    if (!poolAddress) {
      throw new Error(`No Meteora pool found for swap`);
    }

    // Initialize AMM
    const amm = await AmmImpl.create(connection as any, poolAddress);
    
    const isTokenAIn = mintIn.equals(amm.poolState.tokenAMint);
    const inputDecimals = isTokenAIn ? amm.tokenAMint.decimals : amm.tokenBMint.decimals;
    const outputDecimals = isTokenAIn ? amm.tokenBMint.decimals : amm.tokenAMint.decimals;
    
    const amountInLamports = new BN(Math.floor(params.amountIn * Math.pow(10, inputDecimals)));
    const minAmountOutLamports = new BN(Math.floor(params.minAmountOut * Math.pow(10, outputDecimals)));

    // Get swap transaction
    const swapTx = await amm.swap(
      wallet.publicKey,
      mintIn,
      amountInLamports,
      minAmountOutLamports
    );

    // Sign and send transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = wallet.publicKey;
    
    swapTx.sign(wallet);
    
    const txId = await connection.sendRawTransaction(swapTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Confirm transaction
    await connection.confirmTransaction({
      signature: txId,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    // Calculate execution price
    const executionPrice = params.minAmountOut / params.amountIn;

    return {
      txHash: txId,
      executionPrice,
    };
  }

  /**
   * Helper to find pool address for token pair
   * In production, this would query on-chain or use an API
   * For now, searches known devnet pools
   */
  private findPoolAddress(tokenA: string, tokenB: string): PublicKey | null {
    // DEVNET_POOL is an object with named pools, not an array
    const poolEntries = Object.entries(DEVNET_POOL);
    
    for (const [poolName, poolAddress] of poolEntries) {
      // For devnet, we need to fetch pool info to check mints
      // For now, return the first available pool that matches common pairs
      // In production, implement proper pool discovery
      if (poolName.includes('USDC') || poolName.includes('SOL')) {
        return poolAddress as PublicKey;
      }
    }
    
    return null;
  }
}
