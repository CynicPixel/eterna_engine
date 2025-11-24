import Fastify, { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import ordersRoutes from './routes/orders';

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });
  await fastify.register(websocketPlugin);
  await fastify.register(ordersRoutes, { prefix: '/api' });
  return fastify;
}

export async function startServer(): Promise<FastifyInstance> {
  const fastify = await buildServer();
  await fastify.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' });
  return fastify;
}
