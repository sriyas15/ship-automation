const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { processCsv, writeCsv } = require('./csvHandler');
const { sendEmail, getOrCreateLabel, initGmailService, checkHistory, getLastSentTime } = require('./gmailService');
const { checkBounces } = require('./bouncePoller');
const { validateSpamPolicy } = require('./validator');

const app = express();
app.use(cors());
app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const upload = multer({ dest: UPLOADS_DIR });
let currentCsvPath = null;
let currentRegion = null;
let activeRows = [];
let isSending = false;

// Helper function to generate email content for a row
function generateEmailContent(row) {
  const etaStr = row.eta ? ` - ETA ${row.eta}` : '';
  const portStr = row.port ? ` - ${row.port}` : '';
  const subject = `Ship Services Inquiry — ${row.ship_name}${etaStr}${portStr}`;

  const text = `Dear Ship Authority,\n\nWe hope this message finds you well.\n\nWe are reaching out regarding the upcoming port call of ${row.ship_name} (Ship Code: ${row.ship_code}). Our company provides comprehensive port services including fuel supply, provisions, spare parts, and technical support at Dubai, Chennai, Singapore, and Sri Lanka ports.\n\nWe would be glad to assist in making your port stop efficient and seamless. Please feel free to reach out to us to discuss your requirements in advance.\n\nLooking forward to your response.\n\nBest regards,\nTest Company\n123-456-7890`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <p>Dear Ship Authority,</p>
      <p>We hope this message finds you well.</p>
      <p>We are reaching out regarding the upcoming port call of <strong>${row.ship_name}</strong> (Ship Code: ${row.ship_code}). Our company provides comprehensive port services including fuel supply, provisions, spare parts, and technical support at Dubai, Chennai, Singapore, and Sri Lanka ports.</p>
      <p>We would be glad to assist in making your port stop efficient and seamless", Please feel free to reach out to us to discuss your requirements in advance.</p>
      <p>Looking forward to your response.</p>
      <br>
      <div style="border-top: 1px solid #ddd; padding-top: 10px; margin-top: 20px;">
        <p style="margin: 0;"><strong>Best regards,</strong></p>
        <p style="margin: 5px 0 0 0; color: #555;">John Doe | Sales Manager</p>
        <p style="margin: 0; color: #555;"><strong>Test Company</strong></p>
        <p style="margin: 0; color: #555;">123-456-7890 | 123 Test Address, City</p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

// Initialize Gmail Service early
initGmailService('default');

// Cron job to poll bounces every 1 minute
cron.schedule('* * * * *', async () => {
  if (currentCsvPath && activeRows.length > 0 && currentRegion) {
    console.log(`Polling for bounces for region ${currentRegion}...`);
    await checkBounces(currentCsvPath, activeRows, currentRegion);
  }
});

// 1. Upload CSV
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const region = req.body.region || 'default';
  currentRegion = region;
  currentCsvPath = req.file.path;

  // Initialize region client if possible
  initGmailService(currentRegion);

  try {
    const rawRows = await processCsv(currentCsvPath);

    const grouped = {};
    for (const row of rawRows) {
      const key = row.ship_code || row.ship_name || row.email;
      if (!grouped[key]) {
        grouped[key] = { ...row };
      } else {
        if (row.email && !grouped[key].email.includes(row.email)) {
          grouped[key].email += `, ${row.email}`;
        }
      }
    }
    activeRows = Object.values(grouped);

    for (let row of activeRows) {
      row.already_present = await checkHistory(row, currentRegion);
      row.last_sent_time = await getLastSentTime(row, currentRegion) || 'N/A';

      // Set default status if missing
      if (!row.status) {
        row.status = 'pending';
      }

      // Pre-flight Spam Validation
      const { subject, text, html } = generateEmailContent(row);
      const validation = validateSpamPolicy(row, subject, text, html);
      if (!validation.passed) {
        row.status = 'spam_risk';
        row.error_message = validation.error;
      }
    }
    await writeCsv(currentCsvPath, activeRows);

    let email = null;
    const client = initGmailService(currentRegion);
    if (client) email = client.user;

    res.json({ message: 'File uploaded and validated', rows: activeRows, region: currentRegion, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Status
app.get('/api/status', (req, res) => {
  let email = null;
  if (currentRegion) {
    const client = initGmailService(currentRegion);
    if (client) email = client.user;
  }
  res.json({ rows: activeRows, region: currentRegion, email, isSending });
});

// 3. Start Campaign
app.post('/api/start', async (req, res) => {
  if (!currentCsvPath || activeRows.length === 0) return res.status(400).json({ error: 'No CSV uploaded' });
  if (isSending) return res.status(400).json({ error: 'Already sending' });

  isSending = true;
  res.json({ message: 'Campaign started' });

  try {
    for (let i = 0; i < activeRows.length; i++) {
      const row = activeRows[i];
      if (row.status === 'spam_risk') {
        console.log(`Skipping ${row.ship_code || row.ship_name}: Marked as SPAM RISK.`);
        continue;
      }
      
      if (row.status === 'pending') {
        if (row.last_sent_time && row.last_sent_time !== 'N/A') {
          const lastSent = new Date(row.last_sent_time);
          const now = new Date();
          const diffHours = (now - lastSent) / (1000 * 60 * 60);
          if (diffHours < 24) {
            console.log(`Skipping ${row.ship_code || row.ship_name}: Email sent within 24 hours.`);
            row.status = 'skipped_24h';
            await writeCsv(currentCsvPath, activeRows);
            continue;
          }
        }

        const { subject, text, html } = generateEmailContent(row);

        const emails = row.email ? row.email.split(',').map(e => e.trim()).filter(e => e) : [];
        let anySent = false;

        for (const email of emails) {
          try {
            await sendEmail(email, subject, text, html, currentRegion);
            console.log(`✅ Sent to ${email} using region ${currentRegion}`);
            anySent = true;
            // Randomized delay between 30 and 60 seconds
            const delay = Math.floor(Math.random() * (60000 - 30000 + 1)) + 30000;
            console.log(`Waiting for ${delay / 1000} seconds before next email...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } catch (err) {
            console.error(`❌ Failed to send to ${email}:`, err.message);
          }
        }

        if (anySent) {
          row.status = 'sent';
          row.timestamp = new Date().toISOString();
          row.last_sent_time = row.timestamp;
          row.already_present = await checkHistory(row, currentRegion);
        } else {
          row.status = 'failed';
          row.timestamp = new Date().toISOString();
        }

        await writeCsv(currentCsvPath, activeRows);
      }
    }
  } catch (err) {
    console.error('Campaign error:', err);
  } finally {
    isSending = false;
    console.log('🏁 Campaign finished successfully. Ready for next campaign.');
  }
});

// 4. Download Updated CSV
app.get('/api/download', (req, res) => {
  if (!currentCsvPath) return res.status(404).send('No file available');
  res.download(currentCsvPath, 'updated_ship_emails.csv');
});

// 5. Reset System
app.post('/api/reset', (req, res) => {
  currentCsvPath = null;
  currentRegion = null;
  activeRows = [];
  isSending = false;
  res.json({ message: 'System reset successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
