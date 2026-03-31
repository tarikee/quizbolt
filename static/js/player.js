// ============================================================
// QuizBolt — player.js
// Player WebSocket client
// ============================================================

const CHOICE_COLORS = ['red', 'blue', 'yellow', 'green'];
const CHOICE_ICONS  = ['&#9632;', '&#9650;', '&#9679;', '&#9830;'];

let ws           = null;
let timerInterval = null;
let totalScore   = 0;
let selectedChoice = null;

// ---- Panel helpers ----
function showPanel(id) {
  document.querySelectorAll('.state-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ---- Connect ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.host}/ws/play/${ROOM_CODE}/${encodeURIComponent(NICKNAME)}`;
  ws = new WebSocket(url);

  ws.onopen  = () => console.log('[Player WS] connected');

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = (evt) => {
    clearInterval(timerInterval);
    if (evt.code !== 1000) {
      showError('Connection lost', 'You were disconnected from the game.');
    }
  };

  ws.onerror = () => {
    showError('Connection Error', 'Could not connect to the game server.');
  };
}

function sendWS(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ---- Message router ----
function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':        onJoined(msg);       break;
    case 'question':      onQuestion(msg);     break;
    case 'answer_result': onAnswerResult(msg); break;
    case 'game_over':     onGameOver(msg);     break;
    case 'error':         onServerError(msg);  break;
    default: console.log('[Player] unknown msg', msg);
  }
}

// ---- Joined (lobby) ----
function onJoined(msg) {
  showPanel('panel-waiting');
}

// ---- Question received ----
function onQuestion(msg) {
  clearInterval(timerInterval);
  selectedChoice = null;
  showPanel('panel-question');

  // Progress
  document.getElementById('q-progress').textContent =
    `Question ${msg.question_number} of ${msg.total_questions}`;

  // Question text
  document.getElementById('q-text').textContent = msg.question_text;

  // Render answer buttons
  const grid = document.getElementById('q-choices');
  grid.innerHTML = msg.choices.map((c, i) => `
    <button
      class="answer-btn answer-btn--${i}"
      id="choice-btn-${i}"
      data-id="${escAttr(c.id)}"
      onclick="submitAnswer('${escAttr(c.id)}', ${i})"
    >
      <span class="answer-btn__icon">${CHOICE_ICONS[i]}</span>
      <span>${escHtml(c.choice_text)}</span>
    </button>
  `).join('');

  // Timer
  startTimer(msg.time_limit);
}

// ---- Submit answer ----
function submitAnswer(choiceId, btnIndex) {
  if (selectedChoice !== null) return; // already answered
  selectedChoice = choiceId;

  // Disable all buttons, highlight selected
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i !== btnIndex) {
      btn.style.filter = 'brightness(0.45)';
    }
  });

  // Visual pulse on selected
  const selected = document.getElementById(`choice-btn-${btnIndex}`);
  if (selected) {
    selected.style.transform = 'scale(1.06)';
    selected.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.6)';
  }

  sendWS({ type: 'answer', choice_id: choiceId });
}

// ---- Answer result ----
function onAnswerResult(msg) {
  clearInterval(timerInterval);
  totalScore = msg.total_score;

  // Update score badge
  document.getElementById('score-badge').textContent = `${totalScore.toLocaleString()} pts`;

  // Highlight correct/wrong on current grid before switching panel
  const btns = document.querySelectorAll('.answer-btn');
  btns.forEach(btn => {
    if (btn.dataset.id === msg.correct_choice_id) {
      btn.classList.add('correct');
      btn.style.filter = '';
      btn.style.transform = '';
    } else if (btn.dataset.id === selectedChoice && btn.dataset.id !== msg.correct_choice_id) {
      btn.classList.add('wrong');
    }
  });

  // Brief delay so player sees the correct answer highlighted
  setTimeout(() => {
    showPanel('panel-result');
    const isCorrect = (selectedChoice === msg.correct_choice_id) || msg.correct;

    document.getElementById('result-content').innerHTML = `
      <div class="result-panel ${isCorrect ? 'correct' : 'wrong'}">
        <div class="result-panel__icon">${isCorrect ? '&#10004;' : '&#10008;'}</div>
        <div class="result-panel__title">${isCorrect ? 'Correct!' : 'Wrong!'}</div>
        <div class="result-panel__points">
          ${isCorrect
            ? `+<strong>${msg.points_earned.toLocaleString()}</strong> points`
            : 'No points this round'}
        </div>
        <div class="result-panel__total">Total: ${msg.total_score.toLocaleString()} pts</div>
      </div>
    `;
  }, 1200);
}

// ---- Game Over ----
function onGameOver(msg) {
  clearInterval(timerInterval);
  showPanel('panel-gameover');

  document.getElementById('my-final-score').textContent =
    `${totalScore.toLocaleString()} points`;

  const lb = msg.final_leaderboard || [];
  const lbEl = document.getElementById('final-leaderboard');

  if (lb.length === 0) {
    lbEl.innerHTML = '<p class="text-muted text-center">No results</p>';
    return;
  }

  lbEl.innerHTML = lb.slice(0, 10).map(entry => {
    const isMe = entry.nickname === NICKNAME;
    return `
      <div class="leaderboard-entry" ${isMe ? 'style="border-color:var(--color-accent-bright); background:rgba(224,86,253,0.15);"' : ''}>
        <span class="leaderboard__rank">${entry.rank}</span>
        <span class="leaderboard__name">
          ${escHtml(entry.nickname)}${isMe ? ' <span style="color:var(--color-accent-bright); font-size:0.75rem;">(you)</span>' : ''}
        </span>
        <span class="leaderboard__score">${entry.score.toLocaleString()} pts</span>
      </div>
    `;
  }).join('');
}

// ---- Server error ----
function onServerError(msg) {
  showError('Cannot Join', msg.message || 'An error occurred.');
}

function showError(title, message) {
  showPanel('panel-error');
  document.getElementById('error-title').textContent   = title;
  document.getElementById('error-message').textContent = message;
}

// ---- Timer ----
function startTimer(seconds) {
  clearInterval(timerInterval);
  let left  = seconds;
  const total = seconds;

  renderTimer(left, total);

  timerInterval = setInterval(() => {
    left--;
    renderTimer(left, total);
    if (left <= 0) {
      clearInterval(timerInterval);
    }
  }, 1000);
}

function renderTimer(left, total) {
  const timerNum = document.getElementById('q-timer');
  const timerBar = document.getElementById('q-timer-bar');
  if (!timerNum || !timerBar) return;

  const warning = left <= 5;
  timerNum.textContent = Math.max(0, left);
  timerNum.classList.toggle('warning', warning);

  const pct = total > 0 ? (left / total) * 100 : 0;
  timerBar.style.width = `${Math.max(0, pct)}%`;
  timerBar.classList.toggle('warning', warning);
}

// ---- Utility ----
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Init ----
connect();
