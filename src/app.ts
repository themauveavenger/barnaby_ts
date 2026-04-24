import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);

  await app.register(view, {
    engine: { handlebars },
    root: new URL('./templates', import.meta.url).pathname,
    layout: 'layout.hbs',
    viewExt: 'hbs',
    propertyName: 'view',
  });

  await app.register(basicAuth, {
    validate: async (username, password) => {
      const expectedUser = process.env.BASIC_AUTH_USERNAME;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'barnaby' },
  });

  app.addHook('onRequest', app.basicAuth);

  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);

  return app;
}
