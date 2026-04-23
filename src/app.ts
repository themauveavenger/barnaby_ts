import Fastify from 'fastify';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import memoryRoutes from './routes/memories/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);
  await app.register(memoryRoutes, { prefix: '/memories' });

  return app;
}
