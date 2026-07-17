import Fastify, { type FastifyRequest, type FastifyLoggerOptions } from 'fastify';
import type { LoggerOptions as PinoLoggerOptions } from 'pino';
import basicAuth from '@fastify/basic-auth';
import fStatic from '@fastify/static';
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import embeddingProviderPlugin from './plugins/embedding-provider.js';
import repositoryPlugin from './plugins/repository.js';
import googleAuthPlugin from './plugins/google-auth.js';
import calendarClientPlugin from './plugins/calendar-client.js';
import telegramClientPlugin from './plugins/telegram-client.js';
import schedulerPlugin from './plugins/scheduler.js';
import agentPlugin from './plugins/agent/index.js';
import { registerBriefingJob } from './services/briefing.js';
import { registerAfternoonUpdateJob } from './services/afternoon-update.js';
import registerHandlers from './services/telegram/index.js';
import briefingRepositoryPlugin from './plugins/briefing-repository.js';
import configRepositoryPlugin from './plugins/config-repository.js';
import briefingRoutes from './routes/briefing/index.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';
import healthRoutes from './routes/health/index.js';
import configRoutes from './routes/config/index.js';

type LoggerConfig = FastifyLoggerOptions & PinoLoggerOptions;

function getLoggerConfig(): LoggerConfig {
  return {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: ['err.stack'],
      remove: true
    },
    serializers: {
      req: request => ({
        method: request.method,
        url: request.url,
        path: request.routeOptions.url,
        query: request.query,
        ip: request.ip
      })
    }
  };
}

function getCalendarIds(): string[] {
  const raw = process.env.CALENDAR_IDS;
  if (!raw || raw.trim() === '') {
    throw new Error('CALENDAR_IDS is required. Set it to a comma-separated list of Google Calendar IDs.');
  }
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

export async function buildApp() {
  const app = Fastify({ logger: getLoggerConfig() });

  app.decorate('calendarIds', getCalendarIds());
  app.decorate('timezone', process.env.TIMEZONE || 'America/New_York');

  await app.register(fStatic, {
    root: new URL('../public', import.meta.url).pathname,
    prefix: '/'
  });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(embeddingProviderPlugin);
  await app.register(repositoryPlugin);
  await app.register(briefingRepositoryPlugin);
  await app.register(configRepositoryPlugin);
  await app.register(googleAuthPlugin);
  await app.register(calendarClientPlugin);
  await app.register(telegramClientPlugin);
  await app.register(agentPlugin);
  await app.register(schedulerPlugin);

  app.addHook('onReady', () => {
    registerHandlers(app);
    registerBriefingJob(app);
    registerAfternoonUpdateJob(app);
  });

  handlebars.registerHelper('eq', (a, b) => a === b);

  await app.register(view, {
    engine: { handlebars },
    root: new URL('./templates', import.meta.url).pathname,
    layout: 'layout.hbs',
    viewExt: 'hbs',
    propertyName: 'view'
  });

  await app.register(basicAuth, {
    validate: async (username, password) => {
      const expectedUser = process.env.BASIC_AUTH_USERNAME;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'barnaby' }
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (request.url.startsWith('/health')) {
      done();
      return;
    }
    app.basicAuth(request, reply, done);
  });

  app.addHook('preParsing', async (request) => {
    request.log = request.log.child({
      path: request.routeOptions.url ?? request.url,
      query: request.query,
      ip: request.ip
    });
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, async function (_request: FastifyRequest, payload: string): Promise<Record<string, string | string[]>> {
    const parsed = new URLSearchParams(payload);
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of parsed) {
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) {
          result[key].push(value);
        } else {
          result[key] = [result[key], value];
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);
  await app.register(briefingRoutes, { prefix: '/briefing' });
  await app.register(configRoutes);

  return app;
}
