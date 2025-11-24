import { insertOrder, getOrder, updateOrderStatus } from '../db/repositories/orderRepo';
import { WebSocketManager } from '../api/websocket/manager';

export async function createOrder(orderId: string, payload: any) {
  const order = {
    id: orderId,
    userWallet: payload.userWallet,
    tokenIn: payload.tokenIn,
    tokenOut: payload.tokenOut,
    amountIn: payload.amountIn,
    slippage: payload.slippage || 0.01,
    status: 'pending',
  };
  await insertOrder(order);
  // emit pending status if ws present
  WebSocketManager.sendStatus(orderId, { status: 'pending' });
}

export async function markOrderBuilding(orderId: string, selectedDex: string) {
  await updateOrderStatus(orderId, { status: 'building', selected_dex: selectedDex });
  WebSocketManager.sendStatus(orderId, { status: 'building', selectedDex });
}

export async function markOrderSubmitted(orderId: string, txHash: string) {
  await updateOrderStatus(orderId, { status: 'submitted', tx_hash: txHash });
  WebSocketManager.sendStatus(orderId, { status: 'submitted', txHash });
}

export async function finalizeOrderConfirmed(orderId: string, txHash: string, executionPrice: number) {
  await updateOrderStatus(orderId, { status: 'confirmed', tx_hash: txHash, execution_price: executionPrice });
  WebSocketManager.sendStatus(orderId, { status: 'confirmed', txHash, executionPrice });
}

export async function failOrder(orderId: string, error: string, retryCount = 0) {
  await updateOrderStatus(orderId, { status: 'failed', failure_reason: error, retry_count: retryCount });
  WebSocketManager.sendStatus(orderId, { status: 'failed', error, retryCount });
}
