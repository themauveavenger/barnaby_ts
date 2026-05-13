import type { FastifyInstance } from 'fastify';
import { handleRemember } from './remember.js';
import { handleChat } from './chat.js';

export default function registerHandlers(fastify: FastifyInstance): void {
  const bot = fastify.telegramBot;

  bot.command('remember', (ctx) => handleRemember(ctx, fastify));
  bot.on('message:text', (ctx) => handleChat(ctx, fastify));
}