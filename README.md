# Eterna Engine

A high-performance order execution engine for Solana DEX trading with intelligent routing, real-time WebSocket status updates, and resilient queue-based processing.

## Overview

This system processes market orders across Raydium and Meteora DEXs, automatically selecting the best execution venue based on price comparison. Built with Fastify, BullMQ, PostgreSQL, and Redis, the engine handles concurrent order processing with exponential backoff retry logic and comprehensive failure tracking.

## Demo Video

[![Watch the video](https://img.youtube.com/vi/1wb_8ObfQ_M/hqdefault.jpg)](https://www.youtube.com/watch?v=1wb_8ObfQ_M)

## Design Decisions

**Order Type: Market Orders**

Market orders were chosen for the MVP due to their immediate execution model - no price monitoring or trigger logic required, just best-execution routing at current market prices. The architecture can be extended to support:
- **Limit Orders**: Add a price monitoring worker that polls current prices against target thresholds and triggers execution when conditions are met.
- **Sniper Orders**: Integrate mempool/new-pool event listeners to detect token launches and trigger immediate execution.

**DEX Router Strategy**

The router queries both Raydium CPMM and Meteora Cp-AMM pools concurrently, compares quotes based on output amount and price impact, then selects the optimal venue. This ensures users always receive best execution without manual venue selection.

**HTTP + WebSocket Pattern**

A hybrid endpoint approach satisfies the single-endpoint requirement while working within Fastify's WebSocket constraints:
- `POST /api/orders/execute` - Creates order, returns `{orderId, websocket}` with connection URL
- `GET /api/orders/execute?orderId=<id>` - WebSocket upgrade for status streaming

Clients submit orders via HTTP POST, then connect to the WebSocket with the returned orderId to receive real-time status updates throughout the execution lifecycle.

**Mock Mode for Development**

Adapters in `src/adapters/` currently use deterministic mocks for local development and testing. Production deployment integrates real SDKs (`@raydium-io/raydium-sdk-v2`, `@meteora-ag/cp-amm-sdk`) for Solana devnet execution. This separation allows rapid iteration and comprehensive test coverage without network dependencies.

## Architecture

### Network Stack
- **Fastify 4.27.0**: HTTP server with native WebSocket support via `@fastify/websocket`
- **WebSocket Manager**: Maintains active connections mapped to orderIds, broadcasts status updates in real-time

### Queue & Concurrency
- **BullMQ 5.0.0**: Redis-backed job queue processing up to 10 concurrent orders
- **Exponential Backoff Retry**: Max 3 attempts with delays of 1s, 2s, 4s
- **Failure Persistence**: Retry count and failure reasons stored for post-mortem analysis

### Data Layer
- **PostgreSQL**: Persistent order history with schema including:
  - Order details (id, userWallet, tokens, amounts, slippage)
  - Execution data (selectedDex, executionPrice, txHash)
  - Status tracking (pending → routing → building → submitted → confirmed/failed)
  - Retry metadata (retryCount, failureReason)
- **Redis**: Active order state cache and WebSocket connection registry for fast lookups

### DEX Integration
- **Router** (`src/services/dexRouter.ts`): Orchestrates quote fetching and venue selection
- **Adapters** (`src/adapters/`):
  - `raydiumAdapter.ts` - Raydium CPMM pool interface
  - `meteoraAdapter.ts` - Meteora Cp-AMM pool interface
  - Currently mocked with deterministic responses (100 USDC @ 0.5% impact for Raydium, 102 USDC @ 0.3% for Meteora)
  - Production: Replace mock implementations with actual SDK calls

### Devnet Pool Configuration (SOL/USDC only)
`DEX_MODE=devnet` forces every request to a single wrapped SOL ↔︎ USDC swap. We hardcode the canonical mint pair inside `orderService.ts`, away from the validation layer, so all queued jobs reference:

```
tokenIn  = Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr  // devnet USDC
tokenOut = So11111111111111111111111111111111111111112  // wrapped SOL
```

#### Devnet audit process
1. **Enumerate every pool on-chain** – `node scripts/dumpPools.js` loads both SDKs against devnet RPC:
   - `CpAmm.getAllPools()` from `@meteora-ag/cp-amm-sdk` and a mint-decoder helper persist `meteora-devnet-pools.txt`.
   - Raw `getProgramAccounts` queries against Raydium’s `CREATE_CPMM_POOL_PROGRAM` fetch the first N CPMM accounts (cap configurable via `RAYDIUM_POOL_LIMIT`) and write `raydium-devnet-pools.txt`.
2. **Cross-reference minted pairs** – The script normalizes each `(mintA, mintB)` combination into a sorted `pairKey` and specifically filters for `So1111…` involvement. Any overlap is printed as `Found overlapping SOL pair across Meteora/Raydium` together with both pool descriptors.
3. **Manual verification** – Once an overlap appears, we confirm decimals and identify mints via Raydium’s `mint/list` REST endpoint plus the Solana token registry to ensure they truly correspond to SOL/USDC.

#### Canonical overlapping pair (2025‑11‑24)
- **Meteora Cp-AMM**: pool `9ovvHUVz8g26BWUXtXrjksz8ZvdFsxLMf763ZrxMvHAz` (`index: 9039`). `tokenA = Gh9…` (USDC, 6 decimals) and `tokenB = So1111…` (SOL, 9 decimals).
- **Raydium CPMM**: pool `3EctRbo17tTSuV2c44X4cx8aGs9HtWRsFCedNRBh3xv6` exposing the same mint pair (order reversed, decimals 9/6 respectively).

The audit output is committed to `scripts/meteora-devnet-pools.txt` and `scripts/raydium-devnet-pools.txt` for traceability. Re-run `node scripts/dumpPools.js` whenever devnet liquidity changes to refresh the data and confirm that the canonical pair still exists (or to discover new overlaps).

### Worker Processing
- **Execution Worker** (`src/workers/executionWorker.ts`):
  - Fetches order from database
  - Queries DEX router for quotes (emits "routing" status)
  - Selects best venue and builds transaction (emits "building")
  - Submits to Solana network (emits "submitted")
  - Polls for confirmation (emits "confirmed" with txHash or "failed" with error)
  - Handles retries with exponential backoff, persists final failures

## Project Structure

```
src/
├── adapters/          # DEX adapter layer (mocked for development)
│   ├── raydiumAdapter.ts
│   └── meteoraAdapter.ts
├── api/
│   ├── routes/
│   │   └── orders.ts  # POST /api/orders/execute, GET /api/orders/execute (WebSocket)
│   └── server.ts      # Fastify server initialization
├── db/
│   ├── migrations/    # SQL migration files
│   ├── orderRepo.ts   # Order CRUD operations
│   └── pool.ts        # PostgreSQL connection pool
├── redis/
│   └── connection.ts  # Redis client initialization
├── services/
│   ├── dexRouter.ts   # Quote comparison and venue selection
│   ├── orderService.ts # Order validation and status management
│   ├── queue.ts       # BullMQ queue initialization
│   └── websocket.ts   # WebSocket connection management
├── types/
│   └── index.ts       # TypeScript interfaces (Order, DexQuote, OrderStatus)
├── utils/
│   └── validation.ts  # Schema validation for order payloads
├── workers/
│   └── executionWorker.ts # BullMQ worker processing execute-order jobs
└── index.ts           # Application entry point

tests/
├── unit/              # Unit tests for validation, adapters, router
└── integration/       # End-to-end tests for API, WebSocket, queue processing
```

## API Reference

### Submit Order
**POST** `/api/orders/execute`

Request:
```json
{
  "userWallet": "5Qa5W...",
  "tokenIn": "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
  "tokenOut": "So11111111111111111111111111111111111111112",
  "amountIn": 1.5,
  "slippage": 0.01
}
```

Response:
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "websocket": "/api/orders/execute?orderId=550e8400-e29b-41d4-a716-446655440000"
}
```

### Stream Status Updates
**GET** `/api/orders/execute?orderId=<orderId>` (WebSocket)

Connect to WebSocket URL returned from POST request. Server streams status updates:

```json
{"orderId": "550e8400...", "status": "pending"}
{"orderId": "550e8400...", "status": "routing", "quotes": [{"dex": "meteora", "amountOut": 102}]}
{"orderId": "550e8400...", "status": "building", "selectedDex": "meteora"}
{"orderId": "550e8400...", "status": "submitted", "txHash": "3nZ5F..."}
{"orderId": "550e8400...", "status": "confirmed", "txHash": "3nZ5F...", "executionPrice": 102.0}
```

Status Lifecycle:
- `pending` - Order received and queued
- `routing` - Comparing DEX prices
- `building` - Creating transaction
- `submitted` - Transaction sent to network
- `confirmed` - Execution successful (includes txHash and executionPrice)
- `failed` - Execution failed (includes error message and retryCount)

## Test Suite

Comprehensive test coverage with 54 tests across 6 test files:

- **Unit Tests (35 tests)**:
  - Validation: 20 tests for schema validation and business rules
  - Adapters: 6 tests for Raydium/Meteora quote fetching
  - Router: 9 tests for venue selection logic

- **Integration Tests (19 tests)**:
  - Order Repository: 7 tests for database operations
  - WebSocket: 7 tests for HTTP POST flow, connection lifecycle, status broadcasting
  - Queue Processing: 5 tests for job execution, retry logic, exponential backoff timing

Run tests: `npm test`

## Setup & Development

### Prerequisites
- Node.js 18+
- Docker & Docker Compose (for PostgreSQL and Redis)
- PowerShell (Windows) or Bash (Linux/Mac)

### Installation

```powershell
# Start infrastructure
docker-compose up -d

# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

Server runs on `http://localhost:3000`

### Environment Configuration

Create `.env` file:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/eterna_engine
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
```

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm test` - Run test suite with Vitest
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run production build
- `npm run migrate` - Apply database migrations

## Future Enhancements

- **Limit Orders**: Add price monitoring worker for conditional execution
- **Sniper Orders**: Integrate mempool listeners for token launch detection
- **Advanced Routing**: Multi-hop routing across DEX pools for optimal prices
- **Rate Limiting**: Per-wallet order throttling to prevent abuse
- **Analytics Dashboard**: Real-time metrics on order volume, success rates, and execution times

## License

MIT

