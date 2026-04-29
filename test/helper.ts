import { buildApp } from '../src/app.js';

export async function buildTestApp() {
  process.env.DATABASE_PATH = ':memory:';
  process.env.BASIC_AUTH_USERNAME = 'test';
  process.env.BASIC_AUTH_PASSWORD = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.YNAB_ACCESS_TOKEN = 'test-ynab-token';

  const app = await buildApp();
  return app;
}
