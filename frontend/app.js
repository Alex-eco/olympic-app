// ===================== CONFIG =========================
const API_URL = "https://olympic-app-qpvd.onrender.com/api";
let sessionToken = null;
let freeQuestionUsed = sessionStorage.getItem('olympic_free_used') === 'true';

// ===================== DOM ELEMENTS ====================
const askBtn = document.getElementById('askBtn');
const buyBtn = document.getElementById('buyBtn');
const answerDiv = document.getElementById('answer');
const priceSpan = document.getElementById('price');
const questionsLeftSpan = document.getElementById('questionsLeft');
const timeLeftSpan = document.getElementById('timeLeft');
const sessionArea = document.getElementById('sessionArea');

// ===================== INIT ============================
(async function init() {
  try {
    const res = await fetch(`${API_URL}/price`);
    const data = await res.json();
    priceSpan.textContent = data.price_usd;
  } catch (err) {
    console.error('Failed to fetch price', err);
  }
})();

// ===================== ASK QUESTION ====================
askBtn.onclick = async () => {
  const question = document.getElementById('question').value.trim();
  const subject = document.getElementById('subject').value;

  if (!question) {
    alert('Please type your question.');
    return;
  }

  // Check if user has session or can use free question
  if (!sessionToken && freeQuestionUsed) {
    alert('Free question used. Please buy a session.');
    return;
  }

  answerDiv.textContent = '🤔 Thinking...';

  try {
    const res = await fetch(`${API_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken, question, subject })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    answerDiv.textContent = data.answer;

    if (!sessionToken && !freeQuestionUsed) {
      freeQuestionUsed = true;
      sessionStorage.setItem('olympic_free_used', 'true');
    }

    if (data.questions_left !== undefined) {
      questionsLeftSpan.textContent = data.questions_left;
      if (data.questions_left <= 0) {
        sessionToken = null;
        sessionArea.style.display = 'none';
      }
    }
  } catch (err) {
    answerDiv.textContent = '❌ ' + err.message;
  }
};

// ===================== BUY SESSION ====================
buyBtn.onclick = async () => {
  try {
    const res = await fetch(`${API_URL}/create-invoice`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.checkout_url) {
      window.open(data.checkout_url, '_blank');
      // Simulate payment and create session
      const paid = await fetch(`${API_URL}/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: data.order_id })
      });
      const sdata = await paid.json();
      sessionToken = sdata.token;
      sessionArea.style.display = 'block';
      checkSession();
    } else {
      alert('Failed to create payment session');
    }
  } catch (err) {
    console.error('Payment error:', err);
  }
};

// ===================== POLL SESSION ====================
async function checkSession() {
  if (!sessionToken) return;
  try {
    const res = await fetch(`${API_URL}/session/${sessionToken}`);
    const data = await res.json();
    if (data.questions_left >= 0) {
      questionsLeftSpan.textContent = data.questions_left;
      timeLeftSpan.textContent = new Date(data.expires_at).toLocaleString();
    } else {
      sessionToken = null;
      sessionArea.style.display = 'none';
    }
  } catch (err) {
    console.error('Session check failed', err);
  }
}
setInterval(checkSession, 10000);


