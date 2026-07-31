import type { FastifyInstance } from 'fastify';
import { handleRemember } from './remember.js';
import { handleKillSessions } from './kill-sessions.js';
import { handleChat } from './chat.js';

export default function registerHandlers(fastify: FastifyInstance): void {
  const bot = fastify.telegramBot;

  bot.command('remember', ctx => handleRemember(ctx, fastify));
  bot.command('kill_sessions', ctx => handleKillSessions(ctx, fastify));
  bot.on('message:text', ctx => handleChat(ctx, fastify));
}
