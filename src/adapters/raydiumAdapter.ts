import { DexQuote } from '../types';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { getConnection, getWallet, parsePublicKey } from '../utils/solana';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';

interface DevnetPoolConfig {
  id: string;
  label: string;
  mintA: string;
  mintB: string;
}

const DEVNET_RAYDIUM_CPMM_POOLS: DevnetPoolConfig[] = [
  {
    id: '3EctRbo17tTSuV2c44X4cx8aGs9HtWRsFCedNRBh3xv6',
    label: 'SOL/USDC (Raydium CPMM devnet)',
    mintA: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    mintB: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', // Devnet USDC
  },
];

export class RaydiumAdapter {
  name = 'raydium';
  private raydium: Raydium | null = null;

  private async getRaydium(): Promise<Raydium> {
    if (!this.raydium) {
      const connection = getConnection();
      const wallet = getWallet();
      
      this.raydium = await Raydium.load({
        owner: wallet,
        connection,
        cluster: 'devnet',
        disableFeatureCheck: true,
        disableLoadToken: true, // skip token list API (devnet endpoint is flaky)
        blockhashCommitment: 'finalized',
      });
    }
    return this.raydium;
  }

  private isDevnet(): boolean {
    const endpoint = getConnection().rpcEndpoint?.toLowerCase() ?? '';
    return endpoint.includes('devnet');
  }

  private findDevnetPoolId(mintIn: PublicKey, mintOut: PublicKey): string | null {
    const inKey = mintIn.toBase58();
    const outKey = mintOut.toBase58();
    const match = DEVNET_RAYDIUM_CPMM_POOLS.find((pool) => (
      (pool.mintA === inKey && pool.mintB === outKey) ||
      (pool.mintA === outKey && pool.mintB === inKey)
    ));
    return match ? match.id : null;
  }

  private async resolvePoolId(mintIn: PublicKey, mintOut: PublicKey): Promise<string> {
    if (this.isDevnet()) {
      const fallbackId = this.findDevnetPoolId(mintIn, mintOut);
      if (fallbackId) {
        return fallbackId;
      }
      throw new Error(`No Raydium devnet pool found for pair ${mintIn.toBase58()}/${mintOut.toBase58()}`);
    }

    const raydium = await this.getRaydium();
    const poolsData = await raydium.api.fetchPoolByMints({
      mint1: mintIn,
      mint2: mintOut,
    });
    if (poolsData?.data?.length) {
      return poolsData.data[0].id;
    }

    throw new Error(`No Raydium pool found for pair ${mintIn.toBase58()}/${mintOut.toBase58()}`);
  }

  async getQuote(params: { tokenIn: string; tokenOut: string; amountIn: number; slippage: number }): Promise<DexQuote> {
    const raydium = await this.getRaydium();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);
    const poolId = await this.resolvePoolId(mintIn, mintOut);
    
    // Get pool RPC data for reserves (includes config info)
    const { rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);

    // Determine direction
    const baseIn = mintIn.equals(rpcData.mintA);
    const inputDecimals = baseIn ? rpcData.mintDecimalA : rpcData.mintDecimalB;
    const outputDecimals = baseIn ? rpcData.mintDecimalB : rpcData.mintDecimalA;
    
    // Convert input amount to lamports
    const amountInLamports = new BN(Math.floor(params.amountIn * Math.pow(10, inputDecimals)));
    
    // Compute swap using CPMM curve calculator
    const poolData = {
      baseReserve: rpcData.vaultAAmount,
      quoteReserve: rpcData.vaultBAmount,
      mintB: { address: rpcData.mintB.toBase58() },
      configInfo: rpcData.configInfo!,
      feeOn: rpcData.feeOn,
      poolPrice: new Decimal(rpcData.poolPrice.toString()),
    };

    const swapResult = raydium.cpmm.computeSwapAmount({
      pool: poolData as any,
      amountIn: amountInLamports,
      outputMint: baseIn ? mintOut : mintIn,
      slippage: params.slippage,
      swapBaseIn: true,
    });

    // Convert output to token units
    const amountOut = new Decimal(swapResult.amountOut.toString())
      .div(Math.pow(10, outputDecimals))
      .toNumber();

    const priceImpact = swapResult.priceImpact ? Number(swapResult.priceImpact.toString()) : 0;
    const fee = new Decimal(swapResult.fee.toString()).div(amountInLamports.toString()).toNumber();

    return {
      dex: this.name,
      amountOut,
      priceImpact,
      fee,
      poolAddress: poolId,
    };
  }

  async executeSwap(params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number; userWallet: any }): Promise<{ txHash: string; executionPrice: number }> {
    const raydium = await this.getRaydium();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);

    const poolId = await this.resolvePoolId(mintIn, mintOut);
    const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    
    const baseIn = mintIn.equals(new PublicKey(poolInfo.mintA.address));
    const inputMint = poolInfo[baseIn ? 'mintA' : 'mintB'];
    const outputMint = poolInfo[baseIn ? 'mintB' : 'mintA'];
    
    const amountInLamports = new BN(Math.floor(params.amountIn * Math.pow(10, inputMint.decimals)));
    const minAmountOutLamports = new BN(Math.floor(params.minAmountOut * Math.pow(10, outputMint.decimals)));

    const poolData = {
      baseReserve: rpcData.vaultAAmount,
      quoteReserve: rpcData.vaultBAmount,
      mintB: { address: rpcData.mintB.toBase58() },
      configInfo: rpcData.configInfo!,
      feeOn: rpcData.feeOn,
      poolPrice: new Decimal(rpcData.poolPrice.toString()),
    };

    const swapResult = raydium.cpmm.computeSwapAmount({
      pool: poolData as any,
      amountIn: amountInLamports,
      outputMint: baseIn ? mintOut : mintIn,
      slippage: 0.01,
      swapBaseIn: true,
    });

    // Build and execute swap transaction using minAmountOut from params
    const { execute } = await raydium.cpmm.swap({
      poolInfo,
      poolKeys,
      inputAmount: amountInLamports,
      swapResult: {
        inputAmount: swapResult.amountIn,
        outputAmount: minAmountOutLamports,  // Use user's min acceptable output
      },
      baseIn,
      fixedOut: false,
      txVersion: TxVersion.V0,
      computeBudgetConfig: {
        units: 600000,
        microLamports: 100000,
      },
    });

    console.log('[raydiumAdapter] executing transaction...');
    // Execute transaction
    const { txId } = await execute({ sendAndConfirm: true });
    console.log('[raydiumAdapter] transaction successful:', txId);
    
    // Calculate execution price from actual output
    const actualAmountOut = new Decimal(swapResult.amountOut.toString())
      .div(Math.pow(10, outputMint.decimals))
      .toNumber();
    const executionPrice = actualAmountOut / params.amountIn;

    return {
      txHash: txId,
      executionPrice,
    };
  }
}
