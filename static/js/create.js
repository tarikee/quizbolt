// ============================================================
// QuizBolt — create.js
// Handles dynamic quiz creation form
// ============================================================

const CHOICE_COLORS = ['red', 'blue', 'yellow', 'green'];
const CHOICE_ICONS  = ['&#9632;', '&#9650;', '&#9679;', '&#9830;'];
const TIME_OPTIONS  = [10, 20, 30, 60];

let questionCount = 0;

const questionsContainer = document.getElementById('questions-container');
const addQBtn            = document.getElementById('add-question-btn');
const saveBtn            = document.getElementById('save-btn');
const formError          = document.getElementById('form-error');
const toast              = document.getElementById('toast');

// ---- Toast ----
function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ---- Show / Hide error ----
function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
  formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  formError.classList.add('hidden');
}

// ---- Build a choice row ----
function buildChoiceHTML(qIdx, cIdx) {
  return `
    <div class="choice-item choice-item--${cIdx}" id="q${qIdx}-choice${cIdx}">
      <span style="font-size:1.2rem;">${CHOICE_ICONS[cIdx]}</span>
      <input
        type="text"
        class="choice-text"
        placeholder="Choice ${cIdx + 1}"
        maxlength="120"
        data-qidx="${qIdx}"
        data-cidx="${cIdx}"
      />
      <label class="choice-label" title="Mark as correct">
        <input
          type="radio"
          class="choice-radio"
          name="correct-q${qIdx}"
          value="${cIdx}"
        />
        Correct
      </label>
    </div>
  `;
}

// ---- Build a full question card ----
function buildQuestionCard(qIdx) {
  const timeOptions = TIME_OPTIONS.map(t =>
    `<option value="${t}"${t === 20 ? ' selected' : ''}>${t}s</option>`
  ).join('');

  const choicesHTML = [0, 1, 2, 3].map(c => buildChoiceHTML(qIdx, c)).join('');

  return `
    <div class="question-card" id="question-card-${qIdx}" data-qidx="${qIdx}">
      <div class="question-card__header">
        <span class="question-card__number">Question ${qIdx + 1}</span>
        <button
          class="btn btn--danger btn--icon"
          onclick="removeQuestion(${qIdx})"
          title="Remove question"
        >&#128465; Remove</button>
      </div>

      <div class="question-meta">
        <div class="form-group">
          <label>Question Text</label>
          <input
            type="text"
            class="form-control question-text-input"
            placeholder="Enter your question here…"
            maxlength="300"
            data-qidx="${qIdx}"
          />
        </div>
        <div class="form-group" style="flex:0 0 auto; min-width:120px;">
          <label>Time Limit</label>
          <select class="form-control time-limit-select" data-qidx="${qIdx}">
            ${timeOptions}
          </select>
        </div>
      </div>

      <div class="choices-grid" id="choices-grid-${qIdx}">
        ${choicesHTML}
      </div>
    </div>
  `;
}

// ---- Add a new question ----
function addQuestion() {
  questionCount++;
  const qIdx = questionCount; // 1-based internal ID, used as unique key
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildQuestionCard(qIdx);
  questionsContainer.appendChild(wrapper.firstElementChild);
  // Scroll into view
  document.getElementById(`question-card-${qIdx}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  updateQuestionNumbers();
}

// ---- Remove a question ----
function removeQuestion(qIdx) {
  const card = document.getElementById(`question-card-${qIdx}`);
  if (!card) return;
  const total = questionsContainer.querySelectorAll('.question-card').length;
  if (total <= 1) {
    showToast('Quiz must have at least 1 question.');
    return;
  }
  card.style.transition = 'opacity 0.2s, transform 0.2s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';
  setTimeout(() => { card.remove(); updateQuestionNumbers(); }, 220);
}

// ---- Renumber visible questions ----
function updateQuestionNumbers() {
  const cards = questionsContainer.querySelectorAll('.question-card');
  cards.forEach((card, i) => {
    const numEl = card.querySelector('.question-card__number');
    if (numEl) numEl.textContent = `Question ${i + 1}`;
  });
}

// ---- Gather form data ----
function collectFormData() {
  const title = document.getElementById('quiz-title').value.trim();
  const cards = questionsContainer.querySelectorAll('.question-card');
  const questions = [];

  cards.forEach((card, qOrder) => {
    const qIdx   = card.dataset.qidx;
    const qText  = card.querySelector('.question-text-input').value.trim();
    const tLimit = parseInt(card.querySelector('.time-limit-select').value, 10);

    const choiceInputs = card.querySelectorAll('.choice-text');
    const correctRadio = card.querySelector('.choice-radio:checked');
    const correctIdx   = correctRadio ? parseInt(correctRadio.value, 10) : -1;

    const choices = [];
    choiceInputs.forEach((inp, cOrder) => {
      choices.push({
        choice_text: inp.value.trim(),
        is_correct: cOrder === correctIdx,
        sort_order: cOrder,
      });
    });

    questions.push({
      question_text: qText,
      time_limit: tLimit,
      sort_order: qOrder,
      choices,
      _correctIdx: correctIdx, // for validation only
    });
  });

  return { title, questions };
}

// ---- Validate ----
function validate(data) {
  if (!data.title) return 'Please enter a quiz title.';
  if (data.questions.length === 0) return 'Add at least one question.';
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    const num = i + 1;
    if (!q.question_text) return `Question ${num}: Question text is required.`;
    const nonEmpty = q.choices.filter(c => c.choice_text);
    if (nonEmpty.length < 2) return `Question ${num}: At least 2 choices must be filled in.`;
    if (q._correctIdx === -1) return `Question ${num}: Mark one choice as correct.`;
    if (!q.choices[q._correctIdx]?.choice_text) {
      return `Question ${num}: The marked correct choice cannot be empty.`;
    }
  }
  return null;
}

// ---- Strip internal keys before sending ----
function cleanForAPI(data) {
  return {
    title: data.title,
    questions: data.questions.map(q => {
      const { _correctIdx, ...rest } = q;
      // Only send non-empty choices
      rest.choices = rest.choices.filter(c => c.choice_text);
      return rest;
    }),
  };
}

// ---- Save quiz ----
async function saveQuiz() {
  hideError();
  const data = collectFormData();
  const err  = validate(data);
  if (err) { showError(err); return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/quizzes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanForAPI(data)),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail?.detail || 'Server error');
    }
    showToast('Quiz saved! Redirecting…');
    setTimeout(() => { window.location.href = '/'; }, 1000);
  } catch (e) {
    showError(`Failed to save: ${e.message}`);
    saveBtn.disabled = false;
    saveBtn.innerHTML = '&#128190; Save Quiz';
  }
}

// ---- Event listeners ----
addQBtn.addEventListener('click', addQuestion);
saveBtn.addEventListener('click', saveQuiz);

// ---- Initial state: one question ----
addQuestion();
