import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.readonly'
  ]
});

console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for authorization...');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth2callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    const error = url.searchParams.get('error');
    console.error('Authorization failed:', error);
    res.writeHead(400);
    res.end('Authorization failed. Check your terminal.');
    server.close();
    process.exit(1);
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Authorization successful!');
    console.log('\nAdd this to your .env file:');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    res.writeHead(200);
    res.end('Authorization successful! You can close this tab.');
  } catch (err) {
    console.error('Failed to exchange code for tokens:', err);
    res.writeHead(500);
    res.end('Failed to exchange code. Check your terminal.');
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(3000, () => {
  console.log('Local server listening on http://localhost:3000');
});
