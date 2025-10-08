/*
Olympic frontend (static JS)
- Creates NowPayments invoice via backend, opens checkout URL
- Polls for purchase completion and creates session
- Keeps session token in sessionStorage during 2-hour window
- Shows remaining time and questions; allows asking questions via /api/ask
*/

const API_BASE = ''; // leave empty to use same origin when deployed together, or set to your backend URL when testing
let SESSION_PRICE = 2.0;
let sessionToken = sessionStorage.getItem('olympic_session_token') || null;
let sessionExpires = sessionStorage.getItem('olympic_session_expires') || null;
let questionsLeft = parseInt(sessionStorage.getItem('olympic_questions_left') || '0', 10);

document.getElementById('price').textContent = SESSION_PRICE.toFixed(2);

async function refreshSessionUI() {
  if (!sessionToken) return;
  try {
    const resp = await fetch(`${API_BASE}/api/session/${sessionToken}`);
    if (!resp.ok) { console.warn('session fetch failed'); return; }
    const j = await resp.json();
    sessionExpires = j.expires_at;
    questionsLeft = j.questions_left;
    sessionStorage.setItem('olympic_session_token', sessionToken);
    sessionStorage.setItem('olympic_session_expires', sessionExpires);
    sessionStorage.setItem('olympic_questions_left', questionsLeft);
    document.getElementById('questionsLeft').textContent = questionsLeft;
    document.getElementById('sessionArea').style.display = 'block';
    document.getElementById('purchase').style.display = 'none';
    // update countdown
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
    const hrs = Math.floor(msLeft/3600000);
    const mins = Math.floor((msLeft%3600000)/60000);
    const secs = Math.floor((msLeft%60000)/1000);
    el.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }
  tick();
  setInterval(tick, 1000);
}

document.getElementById('buyBtn').onclick = async () => {
  // create invoice
  const resp = await fetch(`${API_BASE}/api/create-invoice`, { method: 'POST' });
  const j = await resp.json();
  if (!resp.ok) {
    alert(j.error || 'Invoice creation failed');
    return;
  }
  // open checkout
  document.getElementById('checkout').innerHTML = 'Opening checkout...';
  window.open(j.checkout_url, '_blank');
  // poll /create-session to detect payment completed
  const orderId = j.order_id;
  document.getElementById('checkout').innerHTML = 'Waiting for payment confirmation...';
  const maxPoll = 60; // poll for up to ~5 minutes
  for (let i=0;i<maxPoll;i++) {
    await new Promise(r=>setTimeout(r,5000));
    const sresp = await fetch(`${API_BASE}/api/create-session`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ order_id: orderId})
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

document.getElementById('askBtn').onclick = async () => {
  const q = document.getElementById('question').value.trim();
  const subj = document.getElementById('subject').value;
  if (!q) return alert('Write a question first.');
  if (!sessionToken) return alert('No active session. Please buy a session first.');
  const resp = await fetch(`${API_BASE}/api/ask`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token: sessionToken, question: q, subject: subj})
  });
  const j = await resp.json();
  if (!resp.ok) {
    alert(j.error || 'Error asking question');
    if (j.error === 'no questions left' || j.error === 'session expired') {
      sessionStorage.removeItem('olympic_session_token');
      sessionStorage.removeItem('olympic_session_expires');
      sessionStorage.removeItem('olympic_questions_left');
      location.reload();
    }
    return;
  }
  document.getElementById('answer').textContent = j.answer;
  // update local count
  questionsLeft = parseInt(sessionStorage.getItem('olympic_questions_left') || questionsLeft) - 1;
  sessionStorage.setItem('olympic_questions_left', questionsLeft);
  document.getElementById('questionsLeft').textContent = questionsLeft;
});

// on page load, refresh UI if session exists
if (sessionToken) refreshSessionUI();
