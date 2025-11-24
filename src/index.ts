import 'dotenv/config';
import { startServer } from './api/server';
import { startWorker } from './workers/executionWorker';

async function main() {
  const fastify = await startServer();
  const addressInfo = fastify.server.address();
  const address = typeof addressInfo === 'object' && addressInfo
    ? `${addressInfo.address}:${addressInfo.port}`
    : String(addressInfo);
  console.log(`API listening on ${address}`);

  // start worker in same process for simplicity (can be separate)
  await startWorker();
}

main().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
