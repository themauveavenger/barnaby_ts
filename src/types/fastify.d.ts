import type { Database } from 'better-sqlite3';
import type { MemoryRepository, MemoryActionRepository } from '../plugins/repository.js';
import type { BriefingRepository } from '../plugins/briefing-repository.js';
import type { AgentServices } from '../plugins/agent/index.js';
import type { ConfigRepository } from '../plugins/repositories/config.js';
import type { PersonalityRepository } from '../plugins/repositories/personality.js';
import type { OAuth2Client } from 'google-auth-library';
import type { CalendarClient } from '../plugins/calendar-client.js';
import type { TelegramClient } from '../plugins/telegram-client.js';
import type { Bot, Context } from 'grammy';
import type { ToadScheduler } from '@fastify/schedule';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
    memoryActionRepository: MemoryActionRepository;
    briefingRepository: BriefingRepository;
    agent: AgentServices;
    configRepository: ConfigRepository;
    personalityRepository: PersonalityRepository;
    googleAuth: { oauth2Client: OAuth2Client };
    calendarClient: CalendarClient;
    calendarIds: string[];
    timezone: string;
    telegramClient: TelegramClient;
    telegramBot: Bot<Context>;
    scheduler: ToadScheduler;
  }
}
