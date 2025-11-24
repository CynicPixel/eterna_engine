import WebSocket from 'ws';

class WSManager {
  private map: Map<string, WebSocket> = new Map();

  register(orderId: string, ws: WebSocket) {
    this.map.set(orderId, ws);
  }

  sendStatus(orderId: string, payload: any) {
    const ws = this.map.get(orderId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ orderId, ...payload }));
  }

  unregister(orderId: string) {
    this.map.delete(orderId);
  }
}

export const WebSocketManager = new WSManager();
