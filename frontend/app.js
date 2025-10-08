/*
Olympic frontend (static JS)
- Password gate: Olympic2025!
- Allows 1 free answer (tracked in sessionStorage)
- Then requires payment session (NowPayments)
*/
// ===== Password Gate =====
const ACCESS_PASSWORD = "Olympic2025!";
const storedAccess = sessionStorage.getItem('olympic_access_granted');
let freeQuestionUsed = sessionStorage.getItem('olympic_free_used') === 'true';

document.getElementById('accessBtn').onclick = () => {
  const entered = document.getElementById('accessPassword').value.trim();
  if (entered === ACCESS_PASSWORD) {
    sessionStorage.setItem('olympic_access_granted', 'true');
    document.getElementById('passwordGate').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
  } else {
    document.getElementById('accessError').textContent = 'Invalid access password';
  }
};

if (storedAccess === 'true') {
  document.getElementById('passwordGate').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
}

const API_BASE = 'https://olympic-app-qpvd.onrender.com';
const ACCESS_PASSWORD = 'Olympic2025!';

let SESSION_PRICE = 2.0;
let sessionToken = sessionStorage.getItem('olympic_session_token') || null;
let sessionExpires = sessionStorage.getItem('olympic_session_expires') || null;
let questionsLeft = parseInt(sessionStorage.getItem('olympic_questions_left') || '0', 10);
let firstFreeUsed = sessionStorage.getItem('olympic_first_free_used') === '1';
let unlocked = sessionStorage.getItem('olympic_unlocked') === '1';

document.getElementById('price').textContent = SESSION_PRICE.toFixed(2);

// =================== PASSWORD GATE ===================
function askPasswordIfNeeded() {
  if (unlocked) return;
  const p = prompt('Enter site access password:');
  if (p === ACCESS_PASSWORD) {
    sessionStorage.setItem('olympic_unlocked', '1');
    unlocked = true;
  } else {
    alert('Incorrect password. Access limited.');
  }
}
askPasswordIfNeeded();

// =================== SESSION UI ===================
async function refreshSessionUI() {
  if (!sessionToken) return;
  try {
    const resp = await fetch(`${API_BASE}/api/session/${sessionToken}`);
    if (!resp.ok) return;
    const j = await resp.json();
    sessionExpires = j.expires_at;
    questionsLeft = j.questions_left;
    sessionStorage.setItem('olympic_session_token', sessionToken);
    sessionStorage.setItem('olympic_session_expires', sessionExpires);
    sessionStorage.setItem('olympic_questions_left', questionsLeft);
    document.getElementById('questionsLeft').textContent = questionsLeft;
    document.getElementById('sessionArea').style.display = 'block';
    document.getElementById('purchase').style.display = 'none';
    startCountdown(new Date(sessionExpires));
  } catch (err) {
    console.error(err);
  }
}

function startCountdown(expireDate) {
  const el = document.getElementById('timeLeft');
  function tick() {
    const msLeft = expireDate - new Date();
    if (msLeft <= 0) {
      el.textContent = '00:00:00';
      alert('Session expired');
      sessionStorage.removeItem('olympic_session_token');
      sessionStorage.removeItem('olympic_session_expires');
      sessionStorage.removeItem('olympic_questions_left');
      location.reload();
      return;
    }
    const hrs = Math.floor(msLeft / 3600000);
    const mins = Math.floor((msLeft % 3600000) / 60000);
    const secs = Math.floor((msLeft % 60000) / 1000);
    el.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }
  tick();
  setInterval(tick, 1000);
}

// =================== PAYMENT ===================
document.getElementById('buyBtn').onclick = async () => {
  const resp = await fetch(`${API_BASE}/api/create-invoice`, { method: 'POST' });
  const j = await resp.json();
  if (!resp.ok) {
    alert(j.error || 'Invoice creation failed');
    return;
  }
  document.getElementById('checkout').innerHTML = 'Opening checkout...';
  window.open(j.checkout_url, '_blank');
  document.getElementById('checkout').innerHTML = 'Waiting for payment confirmation...';
  const orderId = j.order_id;
  const maxPoll = 60;
  for (let i = 0; i < maxPoll; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const sresp = await fetch(`${API_BASE}/api/create-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    });
    const sj = await sresp.json();
    if (sj.token) {
      sessionToken = sj.token;
      sessionExpires = sj.expires_at;
      questionsLeft = sj.questions_left;
      sessionStorage.setItem('olympic_session_token', sessionToken);
      sessionStorage.setItem('olympic_session_expires', sessionExpires);
      sessionStorage.setItem('olympic_questions_left', questionsLeft);
      refreshSessionUI();
      return;
    }
  }
  alert('Payment not detected yet. If you completed payment, wait a bit or contact support.');
};

// =================== ASK ===================
document.getElementById('askBtn').onclick = async () => {
  const q = document.getElementById('question').value.trim();
  const subj = document.getElementById('subject').value;
  if (!q) return alert('Write a question first.');

  // 👇 One free answer logic
  if (!firstFreeUsed) {
    try {
      const resp = await fetch(`${API_BASE}/api/ask_public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, subject: subj })
      });
      const j = await resp.json();
      if (!resp.ok) return alert(j.error || 'Error');
      document.getElementById('answer').textContent = j.answer;
      firstFreeUsed = true;
      sessionStorage.setItem('olympic_first_free_used', '1');
      return;
    } catch (err) {
      console.error(err);
      alert('Free question failed.');
      return;
    }
  }

  // After free question: must have active session
if (!sessionToken) {
  if (!freeQuestionUsed) {
    // First free question
    freeQuestionUsed = true;
    sessionStorage.setItem('olympic_free_used', 'true');
  } else {
    alert('Your free question is used. Please buy a session to continue.');
    return;
  }
}


  const resp = await fetch(`${API_BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: sessionToken, question: q, subject: subj })
  });
  const j = await resp.json();
  if (!resp.ok) {
    alert(j.error || 'Error asking question');
    if (j.error === 'no questions left' || j.error === 'session expired') {
      sessionStorage.clear();
      location.reload();
    }
    return;
  }
  document.getElementById('answer').textContent = j.answer;
  questionsLeft = parseInt(sessionStorage.getItem('olympic_questions_left') || questionsLeft) - 1;
  sessionStorage.setItem('olympic_questions_left', questionsLeft);
  document.getElementById('questionsLeft').textContent = questionsLeft;
};

// =================== INIT ===================
if (sessionToken) refreshSessionUI();

