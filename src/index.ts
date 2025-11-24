import 'dotenv/config';
import { startServer } from './api/server';
import { startWorker } from './workers/executionWorker';

async function main() {
  const server = await startServer();
  console.log(`API listening on ${server.address()}`);

  // start worker in same process for simplicity (can be separate)
  await startWorker();
}

main().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
