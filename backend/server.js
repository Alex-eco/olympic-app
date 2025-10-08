/*
Olympic backend (Express)
- Sessions and purchases stored in SQLite (backend/db.sqlite)
- Create NowPayments invoice -> user pays -> webhook marks paid -> create session
- Session: token, created_at, expires_at, questions_left (40 default)
- /api/ask endpoint checks session validity, decrements questions, and calls OpenAI
- .env must contain OPENAI_API_KEY and NOWPAYMENTS_API_KEY and optionally NOWPAYMENTS_IPN_SECRET
*/

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY || null;
const NOWPAYMENTS_KEY = process.env.NOWPAYMENTS_API_KEY || null;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || null;
const SESSION_PRICE_USD = parseFloat(process.env.SESSION_PRICE_USD || '2.0');

if (!OPENAI_KEY) console.warn("WARNING: OPENAI_API_KEY not set in env");
if (!NOWPAYMENTS_KEY) console.warn("WARNING: NOWPAYMENTS_API_KEY not set in env");

let db;
(async ()=>{
  db = await sqlite.open({ filename: process.env.DATABASE_URL || './db.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      invoice_id TEXT,
      status TEXT,
      amount_usd REAL,
      crypto_currency TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      purchase_id TEXT,
      created_at DATETIME,
      expires_at DATETIME,
      questions_left INTEGER
    );
  `);
})();

// Serve frontend
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, '..','frontend','index.html')));

// Public config
app.get('/api/config', (req,res)=>{
  res.json({ message: 'Olympic API', models_accuracy: '79-100%', session_price_usd: SESSION_PRICE_USD });
});

// Create NowPayments invoice
app.post('/api/create-invoice', async (req,res)=>{
  // amount in USD
  const amount = SESSION_PRICE_USD;
  const order_id = uuidv4();
  try {
    const payload = {
      price_amount: amount,
      price_currency: 'usd',
      pay_currency: 'btc,eth,ltc', // allow multiple, NowPayments may choose
      order_id: order_id,
      order_description: 'Olympic session (40 questions / 2 hours)'
    };
    const resp = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    // store purchase
    await db.run("INSERT INTO purchases (id, invoice_id, status, amount_usd, crypto_currency) VALUES (?,?,?,?,?)",
      [order_id, data.id, data.status || 'pending', amount, (data.pay_currency || null)]
    );
    return res.json({ checkout_url: data.invoice_url || data.payment_url || data.url, order_id, invoice: data });
  } catch (err) {
    console.error('nowpayments error', err);
    return res.status(500).json({ error: 'invoice creation failed' });
  }
});

// NowPayments webhook endpoint (configure this URL in NowPayments dashboard)
// This endpoint should verify signature or secret if you set one in NowPayments
app.post('/api/webhook/nowpayments', async (req,res)=>{
  // NowPayments will POST JSON with invoice info.
  const payload = req.body;
  // simple handling - in production verify signature/ipn_secret
  try {
    // expected fields: id, order_id, payment_status
    const invoiceId = payload.id || payload.invoice_id || null;
    const status = payload.payment_status || payload.status || payload.payment;
    // find matching purchase
    if (payload.order_id) {
      const purchase = await db.get("SELECT * FROM purchases WHERE id = ?", [payload.order_id]);
      if (purchase) {
        // update purchase status
        await db.run("UPDATE purchases SET status = ? WHERE id = ?", [status, payload.order_id]);
        if (status === 'finished' || status === 'confirmed' || status === 'paid') {
          // create session: 2 hours from now and 40 questions
          const token = uuidv4();
          const now = new Date();
          const expires = new Date(now.getTime() + 1000*60*60*2); // +2 hours
          await db.run("INSERT INTO sessions (token, purchase_id, created_at, expires_at, questions_left) VALUES (?,?,?,?,?)",
            [token, purchase.id, now.toISOString(), expires.toISOString(), 40]);
          // Optionally notify user via frontend (not implemented)
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).json({ error: 'webhook handling failed' });
  }
});

// Admin helper to mark invoice paid (for testing, not exposed in production)
app.post('/api/admin/mark-paid', async (req,res)=>{
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const purchase = await db.get("SELECT * FROM purchases WHERE id = ?", [order_id]);
  if (!purchase) return res.status(404).json({ error: 'purchase not found' });
  await db.run("UPDATE purchases SET status = 'finished' WHERE id = ?", [order_id]);
  // create session
  const token = uuidv4();
  const now = new Date();
  const expires = new Date(now.getTime() + 1000*60*60*2);
  await db.run("INSERT INTO sessions (token, purchase_id, created_at, expires_at, questions_left) VALUES (?,?,?,?,?)",
    [token, purchase.id, now.toISOString(), expires.toISOString(), 40]);
  return res.json({ ok: true, token });
});

// Create session by purchase id (polling style) - returns session token if purchase finished
app.post('/api/create-session', async (req,res)=>{
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  const purchase = await db.get("SELECT * FROM purchases WHERE id = ?", [order_id]);
  if (!purchase) return res.status(404).json({ error: 'purchase not found' });
  if (purchase.status === 'finished' || purchase.status === 'confirmed' || purchase.status === 'paid') {
    // see if session already created
    const s = await db.get("SELECT * FROM sessions WHERE purchase_id = ?", [purchase.id]);
    if (s) return res.json({ token: s.token, expires_at: s.expires_at, questions_left: s.questions_left });
    // create session
    const token = uuidv4();
    const now = new Date();
    const expires = new Date(now.getTime() + 1000*60*60*2);
    await db.run("INSERT INTO sessions (token, purchase_id, created_at, expires_at, questions_left) VALUES (?,?,?,?,?)",
      [token, purchase.id, now.toISOString(), expires.toISOString(), 40]);
    return res.json({ token, expires_at: expires.toISOString(), questions_left: 40 });
  } else {
    return res.json({ status: purchase.status });
  }
});

// Get session status
app.get('/api/session/:token', async (req,res)=>{
  const token = req.params.token;
  const s = await db.get("SELECT * FROM sessions WHERE token = ?", [token]);
  if (!s) return res.status(404).json({ error: 'session not found' });
  const now = new Date();
  const expires = new Date(s.expires_at);
  const msLeft = Math.max(0, expires - now);
  return res.json({ token: s.token, expires_at: s.expires_at, questions_left: s.questions_left, ms_left: msLeft });
});

// Ask question (main endpoint)
app.post('/api/ask', async (req,res)=>{
  const { token, question, subject } = req.body;
  if (!token || !question) return res.status(400).json({ error: 'token and question required' });
  const s = await db.get("SELECT * FROM sessions WHERE token = ?", [token]);
  if (!s) return res.status(403).json({ error: 'invalid session' });
  const now = new Date();
  if (new Date(s.expires_at) < now) return res.status(403).json({ error: 'session expired' });
  if (s.questions_left <= 0) return res.status(403).json({ error: 'no questions left' });
  // decrement counter
  await db.run("UPDATE sessions SET questions_left = questions_left - 1 WHERE token = ?", [token]);

  // Call OpenAI
  try {
    if (!OPENAI_KEY) return res.status(500).json({ error: 'OpenAI key not configured' });
    const prompt = `You are an expert tutor for ${subject || 'general science and math'}. Answer the question concisely and clearly. Question: ${question}`;
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: JSON.stringify({
        model: "gpt-4o-mini", // choose available model
        messages: [
          { role: "system", content: "You are an expert tutor. Provide clear, step-by-step answers when appropriate."},
          { role: "user", content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      })
    });
    const data = await resp.json();
    const answer = data?.choices?.[0]?.message?.content || (data?.error?.message || 'No answer');
    return res.json({ answer });
  } catch (err) {
    console.error('OpenAI error', err);
    return res.status(500).json({ error: 'generation failed' });
  }
});

app.listen(PORT, ()=>{
  console.log(`Olympic backend listening on port ${PORT}`);
});
