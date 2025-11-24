# Eterna Engine — Minimal Implementation

This project implements the MVP described in the task: Market Order execution with DEX routing between Raydium and Meteora, WebSocket lifecycle streaming, BullMQ queue, PostgreSQL order history, and Redis for active order state.

Quick start (PowerShell):
```powershell
docker-compose up -d
npm install
npm run migrate
npm run dev
```

API:
- `POST /api/orders/execute` (HTTP): returns `{orderId, websocket}` — client may open a WebSocket to `/api/orders/execute` or use the WS flow directly.
- `GET /api/orders/execute` (WebSocket): open a websocket and send the initial order payload as JSON; server replies with `{orderId}` and streams status updates.

Notes:
- Adapters in `src/adapters` are mocked for local development; we will replace with real SDK calls using `@raydium-io/raydium-sdk-v2` and `@meteora-ag/dynamic-amm-sdk` for devnet execution.

