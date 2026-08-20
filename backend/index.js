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
  res.json({ rows: activeRows, region: currentRegion, email });
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

        const subject = `Ship Services Inquiry — ${row.ship_name} (${row.ship_code})`;
        const text = `Dear Ship Authority,\n\nWe hope this message finds you well.\n\nWe are reaching out regarding the upcoming port call of ${row.ship_name} (Ship Code: ${row.ship_code}). Our company provides comprehensive port services including fuel supply, provisions, spare parts, and technical support at Dubai, Chennai, Singapore, and Sri Lanka ports.\n\nWe would be glad to assist in making your port stop efficient and seamless. Please feel free to reach out to us to discuss your requirements in advance.\n\nLooking forward to your response.\n\nBest regards,\nTest Company`;
        
        const emails = row.email ? row.email.split(',').map(e => e.trim()).filter(e => e) : [];
        let anySent = false;
        
        for (const email of emails) {
          try {
            await sendEmail(email, subject, text, currentRegion);
            console.log(`✅ Sent to ${email} using region ${currentRegion}`);
            anySent = true;
            await new Promise(resolve => setTimeout(resolve, 2000));
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
