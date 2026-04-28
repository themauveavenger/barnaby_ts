import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import googleAuthPlugin from '../../src/plugins/google-auth.js';

describe('google-auth plugin', () => {
  it('should decorate fastify with googleAuth when credentials are present', async () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';

    try {
      const app = Fastify({ logger: false });
      await app.register(googleAuthPlugin);
      await app.ready();

      expect(app.hasDecorator('googleAuth')).toBe(true);
      expect(app.googleAuth.oauth2Client).toBeDefined();

      await app.close();
    } finally {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
      process.env.GOOGLE_REFRESH_TOKEN = originalRefreshToken;
    }
  });

  it('should throw when credentials are missing', async () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    try {
      const app = Fastify({ logger: false });
      await expect(app.register(googleAuthPlugin)).rejects.toThrow('Missing Google OAuth credentials');
    } finally {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
      process.env.GOOGLE_REFRESH_TOKEN = originalRefreshToken;
    }
  });
});
