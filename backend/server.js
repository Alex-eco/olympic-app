// ===================== IMPORTS =====================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import fetch from "node-fetch"; // 🟩 Added for NOWPayments

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===================== PATH =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== FRONTEND =====================
app.use(express.static(path.join(__dirname, "../frontend")));

// ===================== SQLITE =====================
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) console.error("❌ Database connection error:", err);
  else console.log("✅ Connected to SQLite database");
});

// ===================== OPENAI =====================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===================== ASK QUESTION =====================
app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }]
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});


// =================================================================
// 🟩 NOWPAYMENTS INTEGRATION START
// =================================================================
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";
const SESSION_PRICE = 2.0;

// In-memory store (or could use DB if needed)
const orders = {};    // order_id -> { paid: bool, checkout_url }
const sessions = {};  // token -> { order_id, questions_left, expires_at }

app.get("/api/price", (req, res) => {
  res.json({ price_usd: SESSION_PRICE });
});

// 🟩 Create invoice
app.post("/api/create-invoice", async (req, res) => {
  try {
    const order_id = "order_" + Date.now();

    const invoiceRes = await fetch(`${NOWPAYMENTS_BASE}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        price_amount: SESSION_PRICE,
        price_currency: "usd",
        pay_currency: "eth",
        order_id,
        success_url: "https://olympic-app-qpvd.onrender.com/success",
        cancel_url: "https://olympic-app-qpvd.onrender.com/cancel",
      })
    });

    const data = await invoiceRes.json();

    if (data.invoice_url) {
      orders[order_id] = { paid: false, checkout_url: data.invoice_url };
      res.json({ checkout_url: data.invoice_url, order_id });
    } else {
      console.error("NOWPayments invoice error:", data);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  } catch (err) {
    console.error("NOWPayments error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🟩 Handle webhook
app.post("/api/webhook/nowpayments", async (req, res) => {
  try {
    const { order_id, payment_status } = req.body;

    if (order_id && payment_status === "finished") {
      if (orders[order_id]) {
        orders[order_id].paid = true;

        // create session
        const token = Math.random().toString(36).substring(2);
        const expires_at = Date.now() + 60 * 60 * 1000; // 1 hour
        sessions[token] = {
          order_id,
          questions_left: 10,
          expires_at
        };
        console.log(`✅ Payment confirmed for ${order_id}, token created`);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// 🟩 Create session manually (for fallback / testing)
app.post("/api/create-session", (req, res) => {
  const { order_id } = req.body;
  if (!order_id || !orders[order_id] || !orders[order_id].paid) {
    return res.status(400).json({ error: "Payment not confirmed" });
  }

  const token = Math.random().toString(36).substring(2);
  const expires_at = Date.now() + 60 * 60 * 1000;
  sessions[token] = { order_id, questions_left: 10, expires_at };
  res.json({ token, expires_at, questions_left: 10 });
});

// 🟩 Check session
app.get("/api/session/:token", (req, res) => {
  const s = sessions[req.params.token];
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
});
// =================================================================
// 🟩 NOWPAYMENTS INTEGRATION END
// =================================================================


// ===================== FRONTEND FALLBACK =====================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

