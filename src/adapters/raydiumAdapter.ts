import { DexQuote } from '../types';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { getConnection, getWallet, parsePublicKey } from '../utils/solana';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';

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
        disableLoadToken: false,
        blockhashCommitment: 'finalized',
      });
    }
    return this.raydium;
  }

  async getQuote(params: { tokenIn: string; tokenOut: string; amountIn: number; slippage: number }): Promise<DexQuote> {
    const raydium = await this.getRaydium();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);
    
    // Search for CPMM pools with this token pair
    const poolsData = await raydium.api.fetchPoolByMints({
      mint1: params.tokenIn,
      mint2: params.tokenOut,
    });

    if (!poolsData || !poolsData.data || poolsData.data.length === 0) {
      throw new Error(`No Raydium pool found for pair ${params.tokenIn}/${params.tokenOut}`);
    }

    const pool = poolsData.data[0];
    
    // Get pool RPC data for reserves
    const poolRpcData = await raydium.cpmm.getRpcPoolInfos([pool.id]);
    const rpcData = poolRpcData[pool.id];
    
    if (!rpcData) {
      throw new Error(`Could not fetch pool RPC data for ${pool.id}`);
    }

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
      poolAddress: pool.id,
    };
  }

  async executeSwap(params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number; userWallet: any }): Promise<{ txHash: string; executionPrice: number }> {
    const raydium = await this.getRaydium();
    
    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);

    // Find pool
    const poolsData = await raydium.api.fetchPoolByMints({
      mint1: params.tokenIn,
      mint2: params.tokenOut,
    });

    if (!poolsData || !poolsData.data || poolsData.data.length === 0) {
      throw new Error(`No Raydium pool found for swap`);
    }

    const pool = poolsData.data[0];
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(pool.id);
    
    const baseIn = mintIn.equals(new PublicKey(poolInfo.mintA.address));
    const inputMint = poolInfo[baseIn ? 'mintA' : 'mintB'];
    const outputMint = poolInfo[baseIn ? 'mintB' : 'mintA'];
    
    const amountInLamports = new BN(Math.floor(params.amountIn * Math.pow(10, inputMint.decimals)));

    // Get RPC data for swap computation
    const poolRpcData = await raydium.cpmm.getRpcPoolInfos([pool.id]);
    const rpcData = poolRpcData[pool.id];

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

    // Build and execute swap transaction
    const { execute } = await raydium.cpmm.swap({
      poolInfo,
      poolKeys,
      inputAmount: amountInLamports,
      swapResult: {
        inputAmount: swapResult.amountIn,
        outputAmount: swapResult.amountOut,
      },
      baseIn,
      fixedOut: false,
      txVersion: TxVersion.V0,
      computeBudgetConfig: {
        units: 600000,
        microLamports: 100000,
      },
    });

    // Execute transaction
    const { txId } = await execute({ sendAndConfirm: true });
    
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
