import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleAuth {
  oauth2Client: OAuth2Client;
}

export default fp(async function googleAuthPlugin(fastify: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file.'
    );
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  fastify.decorate('googleAuth', { oauth2Client });
});
