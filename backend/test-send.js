// test-send.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

async function testSend() {
    try {
        const info = await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: process.env.GMAIL_USER, // send to yourself first
            subject: 'Ship Services Inquiry — MV Ocean King (SHP001)',
            text: `Dear Ship Authority,

We are reaching out regarding MV Ocean King (Ship Code: SHP001).
Our company provides port services at Dubai, Chennai, Singapore, and Sri Lanka.

Best regards,
Test Company`,
        });

        console.log('✅ Email sent:', info.messageId);
    } catch (err) {
        console.error('❌ Failed:', err.message);
    }
}

testSend();