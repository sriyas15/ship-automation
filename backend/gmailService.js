const { google } = require('googleapis');
const nodemailer = require('nodemailer');
require('dotenv').config();

const regionClients = {};

function initGmailService(region = 'default') {
  const prefix = region === 'default' ? 'GMAIL' : `${region.toUpperCase()}_GMAIL`;
  
  // We fallback to default client if specific region user/token is missing
  const user = process.env[`${prefix}_USER`] || process.env.GMAIL_USER;
  const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`] || process.env.GMAIL_REFRESH_TOKEN;
  
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn(`⚠️ Gmail OAuth2 credentials not fully configured in .env yet for region: ${region}`);
    return null;
  }

  if (regionClients[region]) {
    return regionClients[region];
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
  
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  regionClients[region] = { oauth2Client, gmail, user, refreshToken, clientId, clientSecret };
  return regionClients[region];
}

// Function to get or create a label in Gmail
async function getOrCreateLabel(labelName, region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData || !clientData.gmail) return null;
  
  const gmail = clientData.gmail;
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels;
  const existingLabel = labels.find(l => l.name === labelName);
  
  if (existingLabel) {
    return existingLabel.id;
  }
  
  // Create if it doesn't exist
  const createRes = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    }
  });
  return createRes.data.id;
}

// Function to apply a label to a message
async function applyLabelToMessage(messageId, labelId, region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData || !clientData.gmail) return;
  
  const gmail = clientData.gmail;
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: [labelId]
    }
  });
}

// Send email using Nodemailer wrapped with OAuth2
async function sendEmail(to, subject, text, html = '', region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData) {
    throw new Error(`Gmail API not configured for region: ${region}`);
  }
  
  const { oauth2Client, user, refreshToken, clientId, clientSecret } = clientData;
  
  const accessToken = await new Promise((resolve, reject) => {
    oauth2Client.getAccessToken((err, token) => {
      if (err) {
        reject("Failed to create access token");
      }
      resolve(token);
    });
  });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: user, // The email address
      accessToken,
      clientId: clientId,
      clientSecret: clientSecret,
      refreshToken: refreshToken
    }
  });

  const info = await transporter.sendMail({
    from: user,
    to,
    subject,
    text,
    html
  });
  
  return info;
}

async function checkHistory(row, region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData || !clientData.gmail) return 'N/A';

  const gmail = clientData.gmail;

  const terms = [];
  if (row.ship_name) terms.push(`"${row.ship_name.replace(/"/g, '')}"`);
  if (row.ship_code) terms.push(`"${row.ship_code.replace(/"/g, '')}"`);
  if (row.email) terms.push(`"${row.email.replace(/"/g, '')}"`);

  if (terms.length === 0) return 'N/A';

  const queryBase = terms.join(' OR ');

  try {
    const [sentRes, inboxRes] = await Promise.all([
      gmail.users.messages.list({ userId: 'me', q: `(${queryBase}) in:sent`, maxResults: 10 }),
      gmail.users.messages.list({ userId: 'me', q: `(${queryBase}) in:inbox`, maxResults: 10 })
    ]);

    const sentCount = sentRes.data.messages ? sentRes.data.messages.length : 0;
    const inboxCount = inboxRes.data.messages ? inboxRes.data.messages.length : 0;

    if (sentCount === 0 && inboxCount === 0) {
      return 'N/A';
    }

    const parts = [];
    parts.push('already there');
    if (sentCount > 0) parts.push(`${sentCount} in sent`);
    if (inboxCount > 0) {
      if (sentCount > 0) parts.push('and');
      parts.push(`${inboxCount} in inbox`);
    }

    return parts.join(' ');
  } catch (err) {
    console.error(`Error checking history for region ${region}:`, err.message);
    return 'N/A';
  }
}

async function getLastSentTime(row, region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData || !clientData.gmail) return null;

  const gmail = clientData.gmail;

  const terms = [];
  if (row.ship_name) terms.push(`"${row.ship_name.replace(/"/g, '')}"`);
  if (row.ship_code) terms.push(`"${row.ship_code.replace(/"/g, '')}"`);

  if (terms.length === 0) return null;
  const queryBase = terms.join(' OR ');

  try {
    const res = await gmail.users.messages.list({ 
      userId: 'me', 
      q: `(${queryBase}) in:sent`, 
      maxResults: 1 
    });

    if (res.data.messages && res.data.messages.length > 0) {
      const msg = await gmail.users.messages.get({ 
        userId: 'me', 
        id: res.data.messages[0].id, 
        format: 'metadata', 
        metadataHeaders: ['Date'] 
      });
      const dateHeader = msg.data.payload.headers.find(h => h.name === 'Date');
      if (dateHeader) {
        return new Date(dateHeader.value).toISOString();
      }
    }
  } catch (err) {
    console.error(`Error fetching last sent time for region ${region}:`, err.message);
  }
  return null;
}

module.exports = {
  initGmailService,
  getOrCreateLabel,
  applyLabelToMessage,
  sendEmail,
  checkHistory,
  getLastSentTime
};
