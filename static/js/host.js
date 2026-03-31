// ============================================================
// QuizBolt — host.js
// Host WebSocket client
// ============================================================

const CHOICE_COLORS = ['red', 'blue', 'yellow', 'green'];
const CHOICE_ICONS  = ['&#9632;', '&#9650;', '&#9679;', '&#9830;'];

let ws         = null;
let timerInterval = null;
let timerLeft  = 0;
let totalTime  = 0;
let playerCount = 0;
let totalPlayers = 0;

// ---- Panel helpers ----
function showPanel(id) {
  document.querySelectorAll('.state-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setBadge(text) {
  document.getElementById('host-state-badge').textContent = text;
}

// ---- Connect WebSocket ----
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/host/${ROOM_CODE}`);

  ws.onopen = () => console.log('[Host WS] connected');

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = (evt) => {
    clearInterval(timerInterval);
    console.warn('[Host WS] closed', evt.code);
  };

  ws.onerror = (e) => console.error('[Host WS] error', e);
}

function sendWS(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ---- Message router ----
function handleMessage(msg) {
  switch (msg.type) {
    case 'lobby_state':    onLobbyState(msg);   break;
    case 'player_joined':  onPlayerJoined(msg); break;
    case 'player_left':    onPlayerLeft(msg);   break;
    case 'question':       onQuestion(msg);     break;
    case 'answer_received':onAnswerReceived(msg);break;
    case 'question_results':onQuestionResults(msg);break;
    case 'game_over':      onGameOver(msg);     break;
    default: console.log('[Host] unknown msg', msg);
  }
}

// ---- Lobby ----
function onLobbyState(msg) {
  showPanel('panel-lobby');
  setBadge('Lobby');
  document.getElementById('quiz-title-display').textContent = msg.quiz_title || '';
  document.getElementById('lobby-question-count').textContent = msg.question_count;
  const grid = document.getElementById('player-grid');
  grid.innerHTML = '';
  (msg.players || []).forEach(nick => addPlayerChip(nick));
  updateLobbyPlayerCount(msg.players?.length || 0);
}

function onPlayerJoined(msg) {
  addPlayerChip(msg.nickname);
  updateLobbyPlayerCount(msg.player_count);
}

function onPlayerLeft(msg) {
  document.getElementById(`chip-${CSS.escape(msg.nickname)}`)?.remove();
  updateLobbyPlayerCount(msg.player_count);
}

function addPlayerChip(nick) {
  const grid = document.getElementById('player-grid');
  const id   = `chip-${nick}`;
  if (document.getElementById(id)) return; // already there
  const chip = document.createElement('div');
  chip.className = 'player-chip';
  chip.id = id;
  chip.textContent = nick;
  grid.appendChild(chip);
}

function updateLobbyPlayerCount(count) {
  playerCount = count;
  const countEl = document.getElementById('lobby-player-count');
  const startBtn = document.getElementById('start-btn');
  const hintEl   = document.getElementById('start-hint');
  countEl.textContent = count === 0
    ? 'Waiting for players…'
    : `${count} player${count !== 1 ? 's' : ''} joined`;
  startBtn.disabled = count < 1;
  hintEl.textContent = count < 1 ? 'Need at least 1 player to start' : 'Ready to start!';
}

// ---- Question ----
function onQuestion(msg) {
  showPanel('panel-question');
  setBadge(`Q ${msg.question_number} / ${msg.total_questions}`);
  totalTime = msg.time_limit;
  totalPlayers = playerCount;

  document.getElementById('q-progress').textContent =
    `Question ${msg.question_number} of ${msg.total_questions}`;
  document.getElementById('q-text').textContent = msg.question_text;

  // Render choices (host sees correct answer marked)
  const grid = document.getElementById('q-choices-host');
  grid.innerHTML = msg.choices.map((c, i) => {
    const isCorrect = c.is_correct;
    return `
      <div class="answer-btn answer-btn--${i}" style="cursor:default; ${isCorrect ? 'outline:3px solid #fff;' : 'filter:brightness(0.75);'}">
        <span class="answer-btn__icon">${CHOICE_ICONS[i]}</span>
        <span>${escHtml(c.choice_text)}</span>
        ${isCorrect ? '<span style="margin-left:auto; font-size:1.2rem;">&#10003;</span>' : ''}
      </div>
    `;
  }).join('');

  // Reset answer bar
  updateAnswerBar(0, 0);

  // Update player count display
  document.getElementById('q-player-count').textContent =
    `${playerCount} player${playerCount !== 1 ? 's' : ''} in game`;

  // Start timer
  startTimer(msg.time_limit);
}

function onAnswerReceived(msg) {
  updateAnswerBar(msg.answer_count, msg.player_count);
}

function updateAnswerBar(answered, total) {
  const pct = total > 0 ? (answered / total) * 100 : 0;
  document.getElementById('answer-bar').style.width = `${pct}%`;
  document.getElementById('answer-count-label').textContent = `${answered} / ${total}`;
}

// ---- Timer ----
function startTimer(seconds) {
  clearInterval(timerInterval);
  timerLeft = seconds;
  renderTimer(timerLeft, seconds);

  timerInterval = setInterval(() => {
    timerLeft--;
    renderTimer(timerLeft, seconds);
    if (timerLeft <= 0) {
      clearInterval(timerInterval);
      // Timer ran out — auto end from host side
      sendWS({ type: 'end_question' });
    }
  }, 1000);
}

function renderTimer(left, total) {
  const timerNum = document.getElementById('q-timer');
  const timerBar = document.getElementById('q-timer-bar');
  const warning  = left <= 5;

  timerNum.textContent = Math.max(0, left);
  timerNum.classList.toggle('warning', warning);

  const pct = total > 0 ? (left / total) * 100 : 0;
  timerBar.style.width = `${Math.max(0, pct)}%`;
  timerBar.classList.toggle('warning', warning);
}

// ---- Results ----
function onQuestionResults(msg) {
  clearInterval(timerInterval);
  showPanel('panel-results');
  setBadge('Results');

  // Show correct answer label
  const correctChoiceId = msg.correct_choice_id;
  document.getElementById('results-correct-answer').textContent =
    'Reviewing results — next question coming up';

  // Render leaderboard
  renderLeaderboard('results-leaderboard', msg.leaderboard);

  // Update next button label
  const nextBtn = document.getElementById('next-q-btn');
  nextBtn.textContent = 'Next Question →';
}

// ---- Game Over ----
function onGameOver(msg) {
  clearInterval(timerInterval);
  showPanel('panel-gameover');
  setBadge('Finished');

  const lb = msg.final_leaderboard || [];
  renderLeaderboard('final-leaderboard', lb);
  renderPodium(lb);
}

function renderPodium(lb) {
  const podium = document.getElementById('podium-wrap');
  const medals = ['&#129351;', '&#129352;', '&#129353;'];
  const order  = [1, 0, 2]; // second place left, first center, third right
  podium.innerHTML = '';
  order.forEach(rank => {
    const entry = lb[rank];
    if (!entry) return;
    const div = document.createElement('div');
    div.className = `podium-place podium-place--${rank + 1}`;
    div.innerHTML = `
      <div class="podium-place__name">${escHtml(entry.nickname)}</div>
      <div class="podium-place__score">${entry.score} pts</div>
      <div class="podium-place__block">${medals[rank] || '#' + (rank+1)}</div>
    `;
    podium.appendChild(div);
  });
}

// ---- Leaderboard renderer ----
function renderLeaderboard(containerId, data) {
  const el = document.getElementById(containerId);
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="text-muted text-center">No players</p>';
    return;
  }
  el.innerHTML = data.slice(0, 10).map(entry => `
    <div class="leaderboard-entry">
      <span class="leaderboard__rank">${entry.rank}</span>
      <span class="leaderboard__name">${escHtml(entry.nickname)}</span>
      <span class="leaderboard__score">${entry.score.toLocaleString()} pts</span>
    </div>
  `).join('');
}

// ---- Button wiring ----
document.getElementById('start-btn').addEventListener('click', () => {
  sendWS({ type: 'start_game' });
});

document.getElementById('end-q-btn').addEventListener('click', () => {
  clearInterval(timerInterval);
  sendWS({ type: 'end_question' });
});

document.getElementById('next-q-btn').addEventListener('click', () => {
  sendWS({ type: 'next_question' });
});

// ---- Utility ----
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Init ----
connect();
