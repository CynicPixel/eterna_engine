import WebSocket from 'ws';
import redis from '../../redis/client';

type StatusPayload = Record<string, unknown>;

class WSManager {
  private orderSockets = new Map<string, Set<WebSocket>>();
  private pendingPayloads = new Map<string, StatusPayload[]>();
  private heartbeatTimer: NodeJS.Timer;

  constructor() {
    // Keep sockets alive and clean up dead connections
    this.heartbeatTimer = setInterval(() => {
      for (const sockets of this.orderSockets.values()) {
        for (const ws of sockets) {
          const tracker = ws as WebSocket & { isAlive?: boolean };
          if (tracker.isAlive === false) {
            ws.terminate();
            continue;
          }
          tracker.isAlive = false;
          try {
            ws.ping();
          } catch (err) {
            ws.terminate();
          }
        }
      }
    }, 15_000);

    this.heartbeatTimer.unref();
  }

  register(orderId: string, ws: WebSocket) {
    const sockets = this.orderSockets.get(orderId) ?? new Set<WebSocket>();
    sockets.add(ws);
    this.orderSockets.set(orderId, sockets);

    const tracker = ws as WebSocket & { isAlive?: boolean };
    tracker.isAlive = true;

    ws.on('pong', () => {
      tracker.isAlive = true;
    });

    const cleanup = () => this.unregisterSocket(orderId, ws);
    ws.once('close', cleanup);
    ws.once('error', cleanup);

    this.flushBufferedPayloads(orderId, ws);

    // Track active orders in Redis for visibility across workers
    redis.hset('active_orders', orderId, Date.now().toString()).catch(() => undefined);
  }

  async sendStatus(orderId: string, payload: StatusPayload, opts?: { final?: boolean }) {
    const sockets = this.orderSockets.get(orderId);
    if (!sockets || sockets.size === 0) {
      this.bufferPayload(orderId, payload);
      return;
    }

    const message = JSON.stringify({ orderId, ...payload });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (err) {
          this.unregisterSocket(orderId, ws);
        }
      }
    }

    if (opts?.final) {
      await this.complete(orderId);
    }
  }

  unregister(orderId: string) {
    this.complete(orderId).catch(() => undefined);
  }

  private async complete(orderId: string) {
    const sockets = this.orderSockets.get(orderId);
    if (sockets) {
      for (const ws of sockets) {
        try {
          ws.close(1000, 'order-complete');
        } catch (err) {
          // ignore close errors
        }
      }
      this.orderSockets.delete(orderId);
    }

    this.pendingPayloads.delete(orderId);
    try {
      await redis.hdel('active_orders', orderId);
    } catch (err) {
      // non-critical
    }
  }

  private unregisterSocket(orderId: string, ws: WebSocket) {
    const sockets = this.orderSockets.get(orderId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) {
      this.orderSockets.delete(orderId);
      redis.hdel('active_orders', orderId).catch(() => undefined);
    }
  }

  private bufferPayload(orderId: string, payload: StatusPayload) {
    const queue = this.pendingPayloads.get(orderId) ?? [];
    queue.push(payload);
    // Keep last 20 payloads to avoid unbounded growth
    if (queue.length > 20) {
      queue.shift();
    }
    this.pendingPayloads.set(orderId, queue);
  }

  private flushBufferedPayloads(orderId: string, ws: WebSocket) {
    const queue = this.pendingPayloads.get(orderId);
    if (!queue || queue.length === 0) {
      return;
    }
    for (const payload of queue) {
      try {
        ws.send(JSON.stringify({ orderId, ...payload }));
      } catch (err) {
        break;
      }
    }
    this.pendingPayloads.delete(orderId);
  }
}

export const WebSocketManager = new WSManager();
