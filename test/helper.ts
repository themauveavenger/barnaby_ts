import { buildApp } from '../src/app.js';

export async function buildTestApp() {
  process.env.DATABASE_PATH = ':memory:';
  process.env.BASIC_AUTH_USERNAME = 'test';
  process.env.BASIC_AUTH_PASSWORD = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.YNAB_ACCESS_TOKEN = 'test-ynab-token';
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_CHAT_ID = '123456789';
  process.env.CALENDAR_IDS = 'test@example.com,family@group.calendar.google.com';
  process.env.BRIEFING_CRON = '0 7 * * *';

  const app = await buildApp();
  return app;
}
