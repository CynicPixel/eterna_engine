import { DexQuote } from '../types';
import { CpAmm, getTokenProgram } from '@meteora-ag/cp-amm-sdk';
import { getConnection, getWallet, parsePublicKey } from '../utils/solana';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createSyncNativeInstruction, getOrCreateAssociatedTokenAccount, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import Decimal from 'decimal.js';

interface MeteoraPoolConfig {
  name: string;
  address: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  decimalsA: number;
  decimalsB: number;
}

const DEVNET_METEORA_POOLS: MeteoraPoolConfig[] = [
  {
    name: 'USDC/SOL (Meteora Cp-AMM devnet)',
    address: new PublicKey('9ovvHUVz8g26BWUXtXrjksz8ZvdFsxLMf763ZrxMvHAz'),
    mintA: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'), // USDC devnet
    mintB: new PublicKey('So11111111111111111111111111111111111111112'),   // Wrapped SOL
    decimalsA: 6,
    decimalsB: 9,
  },
];

let cachedCpAmm: CpAmm | null = null;

function getCpAmm(): CpAmm {
  if (!cachedCpAmm) {
    cachedCpAmm = new CpAmm(getConnection());
  }
  return cachedCpAmm;
}

const TEN = new Decimal(10);

export class MeteoraAdapter {
  name = 'meteora';

  async getQuote(params: { tokenIn: string; tokenOut: string; amountIn: number; slippage: number }): Promise<DexQuote> {
    const connection = getConnection();
    const cpAmm = getCpAmm();

    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);
    const { config, inputIsTokenA } = this.resolvePoolConfig(mintIn, mintOut);

    const poolState = await cpAmm.fetchPoolState(config.address);
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot).catch(() => null);
    const timestamp = blockTime ?? Math.floor(Date.now() / 1000);

    const inputDecimals = inputIsTokenA ? config.decimalsA : config.decimalsB;
    const outputDecimals = inputIsTokenA ? config.decimalsB : config.decimalsA;
    const amountInLamports = this.toLamports(params.amountIn, inputDecimals);

    const quote = cpAmm.getQuote({
      inAmount: amountInLamports,
      inputTokenMint: mintIn,
      slippage: params.slippage,
      poolState,
      currentTime: timestamp,
      currentSlot: slot,
      tokenADecimal: config.decimalsA,
      tokenBDecimal: config.decimalsB,
    });

    // Ensure pool vault can actually pay the quoted output amount
    const outputVault = inputIsTokenA ? poolState.tokenBVault : poolState.tokenAVault;
    const vaultBalanceInfo = await connection.getTokenAccountBalance(outputVault);
    const vaultLamports = new BN(vaultBalanceInfo.value.amount);
    if (vaultLamports.lt(quote.swapOutAmount)) {
      throw new Error('Meteora pool liquidity is insufficient for the requested output amount');
    }

    const amountOut = this.fromLamports(quote.swapOutAmount, outputDecimals);
    const totalFee = new Decimal(quote.totalFee.toString());
    const feeRatio = amountInLamports.isZero()
      ? 0
      : totalFee.div(amountInLamports.toString()).toNumber();

    return {
      dex: this.name,
      amountOut,
      priceImpact: quote.priceImpact.toNumber(),
      fee: feeRatio,
      poolAddress: config.address.toBase58(),
    };
  }

  async executeSwap(params: { tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number; userWallet: any }): Promise<{ txHash: string; executionPrice: number }> {
    const connection = getConnection();
    const wallet = getWallet();
    const cpAmm = getCpAmm();

    const mintIn = parsePublicKey(params.tokenIn);
    const mintOut = parsePublicKey(params.tokenOut);
    const { config, inputIsTokenA } = this.resolvePoolConfig(mintIn, mintOut);

    const poolState = await cpAmm.fetchPoolState(config.address);
    const inputDecimals = inputIsTokenA ? config.decimalsA : config.decimalsB;
    const outputDecimals = inputIsTokenA ? config.decimalsB : config.decimalsA;

    const amountInLamports = this.toLamports(params.amountIn, inputDecimals);
    const minAmountOutLamports = this.toLamports(params.minAmountOut, outputDecimals);

    if (mintIn.equals(NATIVE_MINT)) {
      await this.ensureNativeLiquidity(connection, wallet, amountInLamports);
    }

    const swapTx = await cpAmm.swap({
      payer: wallet.publicKey,
      pool: config.address,
      inputTokenMint: mintIn,
      outputTokenMint: mintOut,
      amountIn: amountInLamports,
      minimumAmountOut: minAmountOutLamports,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram: getTokenProgram(poolState.tokenAFlag),
      tokenBProgram: getTokenProgram(poolState.tokenBFlag),
      referralTokenAccount: null,
      poolState,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = wallet.publicKey;
    swapTx.sign(wallet);

    const signature = await connection.sendRawTransaction(swapTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    const executionPrice = params.amountIn === 0 ? 0 : params.minAmountOut / params.amountIn;

    return {
      txHash: signature,
      executionPrice,
    };
  }

  private resolvePoolConfig(mintIn: PublicKey, mintOut: PublicKey): { config: MeteoraPoolConfig; inputIsTokenA: boolean } {
    for (const config of DEVNET_METEORA_POOLS) {
      if (config.mintA.equals(mintIn) && config.mintB.equals(mintOut)) {
        return { config, inputIsTokenA: true };
      }
      if (config.mintA.equals(mintOut) && config.mintB.equals(mintIn)) {
        return { config, inputIsTokenA: false };
      }
    }
    throw new Error(`No Meteora Cp-AMM pool configured for pair ${mintIn.toBase58()}/${mintOut.toBase58()}`);
  }

  private toLamports(amount: number, decimals: number): BN {
    if (amount <= 0) {
      return new BN(0);
    }
    const lamports = new Decimal(amount).mul(TEN.pow(decimals)).floor();
    return new BN(lamports.toFixed(0));
  }

  private fromLamports(value: BN, decimals: number): number {
    if (value.isZero()) {
      return 0;
    }
    return new Decimal(value.toString()).div(TEN.pow(decimals)).toNumber();
  }

  private async ensureNativeLiquidity(connection: Connection, wallet: Keypair, amountNeeded: BN): Promise<void> {
    if (amountNeeded.isZero()) {
      return;
    }

    const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, NATIVE_MINT, wallet.publicKey);
    const currentBalance = new BN(ata.amount.toString());
    if (currentBalance.gte(amountNeeded)) {
      return;
    }

    const topUpLamports = amountNeeded.sub(currentBalance);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: ata.address,
        lamports: topUpLamports.toNumber(),
      }),
      createSyncNativeInstruction(ata.address),
    );

    await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: 'confirmed',
    });
  }
}
