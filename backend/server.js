// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Required to resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Serve frontend
const publicPath = path.join(__dirname, "../public");
app.use(express.static(publicPath));

// ✅ Initialize OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ Track first free usage by session (simple memory for demo)
const freeAnswered = new Set();

// Helper to get or create a session token from request
function getSessionToken(req) {
  let token = req.headers["x-session-token"];
  if (!token) {
    // Fallback for anonymous
    token = req.ip;
  }
  return token;
}

// ✅ Route: AI answer
app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.trim() === "") {
      return res.status(400).json({ error: "Question is required." });
    }

    const sessionToken = getSessionToken(req);
    const isFree = !freeAnswered.has(sessionToken);

    // Mark session as used after first free answer
    if (isFree) {
      freeAnswered.add(sessionToken);
    } else {
      // ⚠️ For now, block second question (can be replaced with payment logic)
      return res.status(402).json({
        error: "Free question already used. Please upgrade to continue."
      });
    }

    // ✅ Ask OpenAI for real answer
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant. Answer clearly." },
        { role: "user", content: question }
      ],
      max_tokens: 200
    });

    const aiAnswer = completion.choices[0].message.content;
    return res.json({
      answer: aiAnswer,
      freeUsed: !isFree
    });
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ✅ Fallback to index.html for frontend routes
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Olympic backend listening on port ${PORT}`);
});


