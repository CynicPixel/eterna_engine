import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import ordersRoutes from './routes/orders';

export async function startServer() {
  const fastify = Fastify({ logger: true });
  await fastify.register(websocketPlugin);

  // register routes
  fastify.register(ordersRoutes, { prefix: '/api' });

  await fastify.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' });
  return fastify.server;
}
