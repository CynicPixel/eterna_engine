import { insertOrder, getOrder, updateOrderStatus } from '../db/repositories/orderRepo';
import { WebSocketManager } from '../api/websocket/manager';

const DEVNET_SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEVNET_USDC_MINT = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

// The Meteora/Raydium audit (see README) shows SOL/USDC is the only overlapping devnet pair.
// To keep the execution pipeline deterministic we short-circuit all incoming orders to use that
// pair regardless of user input. Validation still checks addresses for structure, but the order
// that hits the queue will always reference this canonical mint combination.
const HARDCODED_DEVNET_PAIR = Object.freeze({
  tokenIn: DEVNET_SOL_MINT,
  tokenOut: DEVNET_USDC_MINT,
});

export async function createOrder(orderId: string, payload: any) {
  const order = {
    id: orderId,
    userWallet: payload.userWallet,
    tokenIn: HARDCODED_DEVNET_PAIR.tokenIn,
    tokenOut: HARDCODED_DEVNET_PAIR.tokenOut,
    amountIn: payload.amountIn,
    slippage: payload.slippage || 0.01,
    status: 'pending',
  };
  await insertOrder(order);
  // emit pending status if ws present
  await WebSocketManager.sendStatus(orderId, { status: 'pending' });
}

export async function markOrderBuilding(orderId: string, selectedDex: string) {
  await updateOrderStatus(orderId, { status: 'building', selected_dex: selectedDex });
  await WebSocketManager.sendStatus(orderId, { status: 'building', selectedDex });
}

export async function markOrderSubmitted(orderId: string, txHash: string) {
  await updateOrderStatus(orderId, { status: 'submitted', tx_hash: txHash });
  await WebSocketManager.sendStatus(orderId, { status: 'submitted', txHash });
}

export async function finalizeOrderConfirmed(orderId: string, txHash: string, executionPrice: number) {
  await updateOrderStatus(orderId, { status: 'confirmed', tx_hash: txHash, execution_price: executionPrice });
  await WebSocketManager.sendStatus(orderId, { status: 'confirmed', txHash, executionPrice }, { final: true });
}

export async function failOrder(orderId: string, error: string, retryCount = 0) {
  await updateOrderStatus(orderId, { status: 'failed', failure_reason: error, retry_count: retryCount });
  await WebSocketManager.sendStatus(orderId, { status: 'failed', error, retryCount }, { final: true });
}
