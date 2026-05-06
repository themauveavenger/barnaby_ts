import Fastify, { type FastifyRequest, type FastifyLoggerOptions } from 'fastify';
import type { LoggerOptions as PinoLoggerOptions } from 'pino';
import basicAuth from '@fastify/basic-auth';
import helmet from "@fastify/helmet";
import fStatic from "@fastify/static";
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import googleAuthPlugin from './plugins/google-auth.js';
import calendarClientPlugin from './plugins/calendar-client.js';
import ynabClientPlugin from './plugins/ynab-client.js';
import telegramClientPlugin from './plugins/telegram-client.js';
import schedulerPlugin from './plugins/scheduler.js';
import agentPlugin from './plugins/agent/index.js';
import { registerBriefingJob } from './services/briefing.js';
import briefingRepositoryPlugin from './plugins/briefing-repository.js';
import briefingRoutes from './routes/briefing/index.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';
import chatRoutes from './routes/chat/index.js';
import calendarRoutes from './routes/calendar/index.js';

type LoggerConfig = FastifyLoggerOptions & PinoLoggerOptions;

function getLoggerConfig(): LoggerConfig {
  return {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: ['err.stack'],
      remove: true,
    },
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url,
        path: request.routeOptions.url,
        query: request.query,
        ip: request.ip,
      }),
    },
  };
}

function getCalendarIds(): string[] {
  const raw = process.env.CALENDAR_IDS;
  if (!raw || raw.trim() === '') {
    throw new Error('CALENDAR_IDS is required. Set it to a comma-separated list of Google Calendar IDs.');
  }
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

export async function buildApp() {
  const app = Fastify({ logger: getLoggerConfig() });

  app.decorate('calendarIds', getCalendarIds());
  app.decorate('timezone', process.env.TIMEZONE || 'America/New_York');

  await app.register(helmet, {
    hsts: false,
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'font-src': ["'self'", 'https:', 'data:'],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
      },
    },
  });
  await app.register(fStatic, {
    root: new URL("../public", import.meta.url).pathname,
    prefix: "/"
  });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);
  await app.register(briefingRepositoryPlugin);
  await app.register(googleAuthPlugin);
  await app.register(calendarClientPlugin);
  await app.register(ynabClientPlugin);
  await app.register(telegramClientPlugin);
  await app.register(agentPlugin);
  await app.register(schedulerPlugin);

  app.addHook('onReady', () => {
    registerBriefingJob(app);
  });

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

  app.addHook('preParsing', async (request) => {
    request.log = request.log.child({
      path: request.routeOptions.url ?? request.url,
      query: request.query,
      ip: request.ip,
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

  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);
  await app.register(chatRoutes, { prefix: '/chat' });
  await app.register(calendarRoutes, { prefix: '/calendar' });
  await app.register(briefingRoutes, { prefix: '/briefing' });

  return app;
}
