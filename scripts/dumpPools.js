require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { Connection, Keypair } = require('@solana/web3.js');
const { MintLayout } = require('@solana/spl-token');
const { CpAmm } = require('@meteora-ag/cp-amm-sdk');
const { Raydium } = require('@raydium-io/raydium-sdk-v2');

const meteoraOutputPath = path.join(__dirname, 'meteora-devnet-pools.txt');
const raydiumOutputPath = path.join(__dirname, 'raydium-devnet-pools.txt');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_RAYDIUM_LIMIT = Number(process.env.RAYDIUM_POOL_LIMIT) || Infinity;

const pairKey = (a, b) => [a, b].sort().join('::');

async function getMintDecimals(connection, mintKeys = []) {
  // Solana limits getMultipleAccountsInfo to ~100 keys, so chunk requests.
  const uniqueMints = Array.from(
    new Map(mintKeys.map((mint) => [mint.toBase58(), mint])).values()
  );
  const decimals = new Map();
  const chunkSize = 100;
  for (let i = 0; i < uniqueMints.length; i += chunkSize) {
    const chunk = uniqueMints.slice(i, i + chunkSize);
    const infos = await connection.getMultipleAccountsInfo(chunk);
    infos.forEach((info, idx) => {
      const mintKey = chunk[idx];
      if (!info) return;
      try {
        const decoded = MintLayout.decode(info.data);
        decimals.set(mintKey.toBase58(), decoded.decimals);
      } catch (err) {
        console.error(`Failed to decode mint ${mintKey.toBase58()}:`, err.message);
      }
    });
  }
  return decimals;
}

async function dumpMeteora(connection) {
  console.log('--- Meteora Devnet Pools (cp-amm-sdk) ---');
  const cpAmm = new CpAmm(connection);
  let pools = [];
  try {
    pools = await cpAmm.getAllPools();
  } catch (err) {
    console.error('Failed to fetch Meteora pools via cp-amm-sdk:', err.message);
    return [];
  }

  if (!pools.length) {
    console.log('No Meteora pools returned by cp-amm-sdk');
    return [];
  }

  const mintKeys = pools.flatMap(({ account }) => [
    account.tokenAMint,
    account.tokenBMint,
  ]);
  const mintDecimals = await getMintDecimals(connection, mintKeys);

  const formatted = pools.map(({ publicKey, account }, index) => {
    const mintA = account.tokenAMint.toBase58();
    const mintB = account.tokenBMint.toBase58();
    const entry = {
      index,
      poolAddress: publicKey.toBase58(),
      tokenA: mintA,
      tokenB: mintB,
      decimalsA: mintDecimals.get(mintA) ?? null,
      decimalsB: mintDecimals.get(mintB) ?? null,
      poolStatus: account.poolStatus,
    };
    console.log(entry);
    return entry;
  });

  fs.writeFileSync(meteoraOutputPath, formatted.map((p) => JSON.stringify(p)).join('\n'), 'utf8');
  console.log(`Saved ${formatted.length} Meteora pools to ${meteoraOutputPath}`);
  return formatted;
}

async function dumpRaydium(connection, limit = DEFAULT_RAYDIUM_LIMIT) {
  console.log('--- Raydium Devnet CPMM Pools ---');
  const wallet = Keypair.generate();
  const raydium = await Raydium.load({
    owner: wallet,
    connection,
    cluster: 'devnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
  });

  const { DEVNET_PROGRAM_ID, CpmmPoolInfoLayout } = require('@raydium-io/raydium-sdk-v2');
  const cpmmProgramId = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
  const accounts = await connection.getProgramAccounts(cpmmProgramId, {
    filters: [{ dataSize: CpmmPoolInfoLayout.span }],
  });

  const pools = [];
  for (const account of accounts) {
    if (Number.isFinite(limit) && pools.length >= limit) break;
    const id = account.pubkey.toBase58();
    try {
      const rpcInfo = await raydium.cpmm.getRpcPoolInfo(id);
      pools.push({
        id,
        tokenA: rpcInfo.mintA.toBase58(),
        tokenB: rpcInfo.mintB.toBase58(),
        decimalsA: rpcInfo.mintDecimalA,
        decimalsB: rpcInfo.mintDecimalB,
      });
    } catch (err) {
      console.error(`Failed to decode Raydium pool ${id}:`, err.message);
    }
  }

  pools.forEach((pool) => console.log(pool));

  fs.writeFileSync(raydiumOutputPath, pools.map((p) => JSON.stringify(p)).join('\n'), 'utf8');
  console.log(`Saved ${pools.length} Raydium pools to ${raydiumOutputPath}`);
  return pools;
}

function crossReferenceSolPairs(meteoraPools, raydiumPools) {
  if (!meteoraPools.length || !raydiumPools.length) {
    console.log('Skipping SOL pair cross-reference due to missing pool data.');
    return;
  }

  const raydiumSolPairs = new Map();
  raydiumPools.forEach((pool) => {
    if (pool.tokenA === SOL_MINT || pool.tokenB === SOL_MINT) {
      raydiumSolPairs.set(pairKey(pool.tokenA, pool.tokenB), pool);
    }
  });

  let matches = 0;
  meteoraPools.forEach((pool) => {
    if (pool.tokenA !== SOL_MINT && pool.tokenB !== SOL_MINT) return;
    const key = pairKey(pool.tokenA, pool.tokenB);
    const counterpart = raydiumSolPairs.get(key);
    if (counterpart) {
      matches += 1;
      console.log('Found overlapping SOL pair across Meteora/Raydium:', {
        meteora: pool,
        raydium: counterpart,
      });
    }
  });

  if (!matches) {
    console.log('No overlapping Meteora/Raydium SOL pairs detected.');
  }
}

(async () => {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  const meteoraPools = await dumpMeteora(connection);
  const raydiumPools = await dumpRaydium(connection);
  crossReferenceSolPairs(meteoraPools, raydiumPools);
})();
