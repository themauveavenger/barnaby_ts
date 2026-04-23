import { buildApp } from '../src/app.js';

export async function buildTestApp() {
  process.env.DATABASE_PATH = ':memory:';
  process.env.BASIC_AUTH_USERNAME = 'test';
  process.env.BASIC_AUTH_PASSWORD = 'test';

  const app = await buildApp();
  return app;
}
