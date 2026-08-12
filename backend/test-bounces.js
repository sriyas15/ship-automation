const { google } = require('googleapis');
require('dotenv').config();

async function testBounces() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    // Broad search for mailer-daemon
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:mailer-daemon',
      maxResults: 2
    });

    const messages = res.data.messages || [];
    console.log(`Found ${messages.length} bounce messages.`);

    for (const msg of messages) {
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });
      
      const payload = msgData.data.payload;
      const headers = payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value;
      console.log(`\n--- Message ID: ${msg.id} ---`);
      console.log(`Subject: ${subject}`);
      
      let bodyText = '';
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body.data) {
            bodyText += Buffer.from(part.body.data, 'base64').toString();
          } else if (part.mimeType === 'message/delivery-status' || part.mimeType === 'message/rfc822') {
             // Sometimes original email or bounce details are in attached parts
             if (part.parts) {
                for (const subPart of part.parts) {
                   if (subPart.mimeType === 'text/plain' && subPart.body.data) {
                      bodyText += Buffer.from(subPart.body.data, 'base64').toString();
                   }
                }
             }
             if (part.body && part.body.data) {
                 bodyText += Buffer.from(part.body.data, 'base64').toString();
             }
          }
        }
      } else if (payload.body && payload.body.data) {
        bodyText = Buffer.from(payload.body.data, 'base64').toString();
      }
      
      console.log(`Body Snippet: ${bodyText.substring(0, 300)}...`);
    }
  } catch (err) {
    console.error(err);
  }
}

testBounces();
