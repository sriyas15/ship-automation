const { google } = require('googleapis');
const http = require('http');
const url = require('url');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

const scopes = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

async function authenticate() {
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });

  console.log('🔗 Please open this URL in your browser:');
  console.log(authorizeUrl);

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url, true);
      const code = parsedUrl.query.code;
      if (code) {
        res.end('Authentication successful! You can close this tab.');
        server.close();
        const { tokens } = await oauth2Client.getToken(code);
        console.log('✅ Refresh Token generated successfully:');
        console.log(tokens.refresh_token);
        console.log('\n--> Add this to your .env file as GMAIL_REFRESH_TOKEN=...');
        process.exit(0);
      } else {
        res.end('No code provided. Try again.');
      }
    } catch (e) {
      console.error(e);
      res.end('Authentication failed');
    }
  }).listen(3000, () => {
    console.log('\n🎧 Listening on http://localhost:3000/oauth2callback ...');
  });
}

if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
  console.log('❌ Error: GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET is missing from .env');
  process.exit(1);
}

authenticate();
