// Telegram Authentication Microservice
// Deploy this to Vercel, Railway, or Deno Deploy

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Temporary storage for sessions (in production, use Redis or similar)
const sessions = new Map();

app.post('/send-code', async (req, res) => {
  try {
    const { phone, api_id, api_hash } = req.body;

    if (!phone || !api_id || !api_hash) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new TelegramClient(
      new StringSession(''),
      parseInt(api_id),
      api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();

    const result = await client.sendCode(
      {
        apiId: parseInt(api_id),
        apiHash: api_hash
      },
      phone
    );

    await client.disconnect();

    // Store session temporarily
    const sessionKey = `${phone}_${Date.now()}`;
    sessions.set(sessionKey, {
      phoneCodeHash: result.phoneCodeHash,
      timestamp: Date.now()
    });

    // Clean up old sessions (older than 5 minutes)
    for (const [key, value] of sessions.entries()) {
      if (Date.now() - value.timestamp > 300000) {
        sessions.delete(key);
      }
    }

    res.json({
      success: true,
      phone_code_hash: result.phoneCodeHash
    });

  } catch (error) {
    console.error('Send code error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to send code' 
    });
  }
});

app.post('/verify-code', async (req, res) => {
  try {
    const { phone, phone_code_hash, code, api_id, api_hash } = req.body;

    if (!phone || !phone_code_hash || !code || !api_id || !api_hash) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = new TelegramClient(
      new StringSession(''),
      parseInt(api_id),
      api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();

    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: phone_code_hash,
        phoneCode: code
      })
    );

    const sessionString = client.session.save();
    await client.disconnect();

    res.json({
      success: true,
      session_string: sessionString
    });

  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to verify code' 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Telegram Auth Service running on port ${PORT}`);
});
