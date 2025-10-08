// ==================== Olympic Backend ====================

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// ========== CONFIG ==========
const PORT = process.env.PORT || 10000;
const SESSION_DURATION_HOURS = 2;
const SESSION_PRICE = 2.0;
const QUESTIONS_PER_SESSION = 5;
const DB_FILE = './olympic.db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 📁 Папка фронтенда
app.use(express.static(path.join(__dirname, '../frontend')));

// ========== DATABASE ==========
let db;
(async () => {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER,
      questions_left INTEGER,
      questions_asked INTEGER DEFAULT 0,
      paid INTEGER DEFAULT 0
    )
  `);
})();

// ========== HELPER FUNCTIONS ==========
function makeToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function inFuture(hours) {
  return nowUnix() + hours * 3600;
}

// ========== PRICE ENDPOINT ==========
app.get('/api/price', (req, res) => {
  res.json({ price_usd: SESSION_PRICE });
});

// ========== PAYMENT ENDPOINTS (Stub) ==========
app.post('/api/create-invoice', async (req, res) => {
  try {
    const orderId = makeToken();
    const checkoutUrl = `https://nowpayments.io/payment/${orderId}`;

    // создаем незаплаченную сессию
    await db.run(
      `INSERT INTO sessions (token, expires_at, questions_left, paid) VALUES (?, ?, ?, ?)`,
      orderId, inFuture(SESSION_DURATION_HOURS), QUESTIONS_PER_SESSION, 0
    );

    res.json({ order_id: orderId, checkout_url: checkoutUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Invoice creation failed' });
  }
});

// проверка оплаты (эмуляция)
app.post('/api/create-session', async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

  const session = await db.get(`SELECT * FROM sessions WHERE token = ?`, order_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // симуляция успешной оплаты
  await db.run(`UPDATE sessions SET paid = 1 WHERE token = ?`, order_id);

  res.json({
    token: session.token,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    questions_left: QUESTIONS_PER_SESSION
  });
});

// ========== ASK ENDPOINT ==========
app.post('/api/ask', async (req, res) => {
  const { token, question, subject } = req.body;
  if (!token || !question) return res.status(400).json({ error: 'Missing token or question' });

  const session = await db.get(`SELECT * FROM sessions WHERE token = ?`, token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  // Проверка срока действия
  if (session.expires_at < nowUnix()) {
    await db.run(`DELETE FROM sessions WHERE token = ?`, token);
    return res.status(401).json({ error: 'session expired' });
  }

  // ✅ Первая бесплатная
  if (session.paid === 0 && session.questions_asked === 0) {
    const answer = `🤖 First free answer: "${question}" (subject: ${subject})`;
    await db.run(
      `UPDATE sessions SET questions_asked = questions_asked + 1 WHERE token = ?`,
      token
    );
    return res.json({ answer });
  }

  // если нет оставшихся вопросов
  if (session.questions_left <= 0) {
    return res.status(402).json({ error: 'no questions left' });
  }

  // Ответ сессии (здесь могла быть интеграция с OpenAI)
  const answer = `🤖 Paid answer: "${question}" (subject: ${subject})`;

  await db.run(
    `UPDATE sessions SET questions_left = questions_left - 1, questions_asked = questions_asked + 1 WHERE token = ?`,
    token
  );

  res.json({ answer });
});

// ========== SESSION STATUS ==========
app.get('/api/session/:token', async (req, res) => {
  const { token } = req.params;
  const session = await db.get(`SELECT * FROM sessions WHERE token = ?`, token);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    token: session.token,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    questions_left: session.questions_left
  });
});

// ========== SERVE FRONTEND ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`✅ Olympic backend listening on port ${PORT}`);
});

