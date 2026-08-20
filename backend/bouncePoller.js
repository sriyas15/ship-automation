const { google } = require('googleapis');
const { getOrCreateLabel, applyLabelToMessage, checkHistory, initGmailService } = require('./gmailService');
const { processCsv, writeCsv } = require('./csvHandler');

async function checkBounces(csvFilePath, rows, region = 'default') {
  const clientData = initGmailService(region);
  if (!clientData || !clientData.gmail) {
    console.log(`Cannot poll bounces: Missing Gmail OAuth credentials for region ${region}.`);
    return;
  }
  const gmail = clientData.gmail;

  try {
    // Broad search to catch all bounces, but ONLY in the inbox
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: '(from:mailer-daemon OR from:postmaster) in:inbox',
      maxResults: 100
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      console.log(`No new bounce messages found for region ${region}.`);
      return;
    }

    const bouncedLabelId = await getOrCreateLabel('Ship-Bounced', region);
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
            row.already_present = await checkHistory(row, region);
            csvUpdated = true;
            
            // Apply label to the bounce message itself so we know it's processed
            if (bouncedLabelId) {
                await applyLabelToMessage(msg.id, bouncedLabelId, region);
            }
            
            // Optionally, remove INBOX label so it archives it
            await gmail.users.messages.modify({
              userId: 'me',
              id: msg.id,
              requestBody: { removeLabelIds: ['INBOX'] }
            });
            console.log(`Marked ${row.email} (${row.ship_code}) as bounced in region ${region}.`);
            
            // Stop checking other rows for this single bounce message
            break;
          }
        }
      }
    }

    if (csvUpdated) {
      await writeCsv(csvFilePath, rows);
      console.log(`CSV updated with new bounces for region ${region}.`);
    }
    
  } catch (err) {
    console.error(`Error polling bounces for region ${region}:`, err.message);
  }
}

module.exports = {
  checkBounces
};
