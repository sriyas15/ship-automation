const { google } = require('googleapis');
const { getOrCreateLabel, applyLabelToMessage, checkHistory } = require('./gmailService');
const { processCsv, writeCsv } = require('./csvHandler');
require('dotenv').config();

let oauth2Client;
let gmail;

function initPoller() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    return false;
  }
  oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  return true;
}

async function checkBounces(csvFilePath, rows) {
  if (!initPoller()) {
    console.log("Cannot poll bounces: Missing Gmail OAuth credentials.");
    return;
  }

  try {
    // Broad search to catch all bounces, but ONLY in the inbox
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: '(from:mailer-daemon OR from:postmaster) in:inbox',
      maxResults: 100
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      console.log("No new bounce messages found.");
      return;
    }

    const bouncedLabelId = await getOrCreateLabel('Ship-Bounced');
    let csvUpdated = false;

    for (const msg of messages) {
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });
      
      const payload = msgData.data.payload;
      
      let bodyText = '';
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body.data) {
            bodyText += Buffer.from(part.body.data, 'base64').toString();
          } else if (part.mimeType === 'message/delivery-status' || part.mimeType === 'message/rfc822') {
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

      // Check which row matches this bounce
      for (const row of rows) {
        if (row.status === 'sent') {
          const hasValidShipCode = row.ship_code && row.ship_code.trim().length > 0;
          const hasValidEmail = row.email && row.email.trim().length > 0;
          
          const matchesShipCode = hasValidShipCode && bodyText.includes(row.ship_code);
          const matchesEmail = hasValidEmail && bodyText.includes(row.email);
          
          if (matchesShipCode || matchesEmail) {
            row.status = 'bounced';
            row.already_present = await checkHistory(row);
            csvUpdated = true;
            
            // Apply label to the bounce message itself so we know it's processed
            await applyLabelToMessage(msg.id, bouncedLabelId);
            
            // Optionally, remove INBOX label so it archives it
            await gmail.users.messages.modify({
              userId: 'me',
              id: msg.id,
              requestBody: { removeLabelIds: ['INBOX'] }
            });
            console.log(`Marked ${row.email} (${row.ship_code}) as bounced.`);
            
            // Stop checking other rows for this single bounce message
            break;
          }
        }
      }
    }

    if (csvUpdated) {
      await writeCsv(csvFilePath, rows);
      console.log("CSV updated with new bounces.");
    }
    
  } catch (err) {
    console.error("Error polling bounces:", err.message);
  }
}

module.exports = {
  checkBounces
};
