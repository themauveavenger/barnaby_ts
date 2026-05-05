import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';
import type { BriefingRepository } from '../plugins/briefing-repository.js';
import type { AgentServices } from '../plugins/agent/index.js';
import type { OAuth2Client } from 'google-auth-library';
import type { CalendarClient } from '../plugins/calendar-client.js';
import type { YnabClient } from '../plugins/ynab-client.js';
import type { TelegramClient } from '../plugins/telegram-client.js';
import type { ToadScheduler } from '@fastify/schedule';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
    briefingRepository: BriefingRepository;
    agent: AgentServices;
    googleAuth: { oauth2Client: OAuth2Client };
    calendarClient: CalendarClient;
    calendarIds: string[];
    timezone: string;
    ynabClient: YnabClient;
    telegramClient: TelegramClient;
    scheduler: ToadScheduler;
  }
}
