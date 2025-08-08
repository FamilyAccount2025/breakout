// ==============================
// Local Question Bank (fallback)
// ==============================
const BANK = [
  {topic:'basics', difficulty:'easy', q:'What does a health plan deductible represent?', choices:['The fixed amount paid per doctor visit','The maximum you’ll pay in a year','The amount you pay before the plan starts sharing costs','The amount the employer contributes monthly'], answer:2, explain:'The deductible is what a member pays for covered services before the plan starts sharing costs (coinsurance).'},
  {topic:'ancillary', difficulty:'easy', q:'Which is commonly an ancillary benefit?', choices:['Dental','Inpatient surgery','Hospital room and board','Chemotherapy'], answer:0, explain:'Ancillary benefits commonly include dental, vision, life, and disability.'},
  {topic:'funding', difficulty:'easy', q:'What’s a common appeal of a level-funded plan for small employers?', choices:['No stop-loss needed','Potential refund if claims are low','Guaranteed renewals for 10 years','Exemption from ACA mandates'], answer:1, explain:'Level-funded can include a surplus/refund if claims run favorably; ACA rules still apply.'},
  {topic:'compliance', difficulty:'easy', q:'COBRA primarily provides what?', choices:['Subsidized coverage for low-income individuals','Continuation of employer-sponsored coverage after qualifying events','Medicare enrollment assistance','A federal premium tax credit'], answer:1, explain:'COBRA allows qualified beneficiaries to continue employer coverage after certain events.'},
  {topic:'sales', difficulty:'easy', q:'What’s a common first-step in a broker’s discovery with a new group?', choices:['Presenting final rates immediately','Understanding current pain points and objectives','Requesting a 5-year rate guarantee','Quoting only one carrier'], answer:1, explain:'A consultative approach starts with discovery to align solutions with the employer’s objectives.'}
];
const TOPIC_LABELS = {
  basics: 'Basics', ancillary: 'Ancillary', funding: 'Funding', compliance: 'Compliance', sales: 'Sales', mixed: 'Mixed'
};

// ==============================
// State & Element References
// ==============================
const els = {
  setup: document.getElementById('setup'),
  quiz: document.getElementById('quiz'),
  result: document.getElementById('result'),

  topic: document.getElementById('topic'),
  difficulty: document.getElementById('difficulty'),
  count: document.getElementById('count'),
  aimode: document.getElementById('aimode'),
  start: document.getElementById('start'),

  badge: document.getElementById('badge'),
  progressText: document.getElementById('progress'),
  progressFill: document.getElementById('progressFill'),
  qtext: document.getElementById('qtext'),
  answers: document.getElementById('answers'),
  explain: document.getElementById('explain'),

  next: document.getElementById('next'),
  skip: document.getElementById('skip'),
  backSetup: document.getElementById('backSetup'),

  resultBadge: document.getElementById('resultBadge'),
  resultScore: document.getElementById('resultScore'),
  resultNote: document.getElementById('resultNote'),
  retry: document.getElementById('retry'),
  share: document.getElementById('share')
};

let game = null;

// ==============================
// Helpers
// ==============================
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function shuffle(arr) { return arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]); }

function sampleQuestions(topic, difficulty, count, pool=BANK) {
  let subset = pool.filter(q => (topic==='mixed' ? true : q.topic===topic) && q.difficulty===difficulty);
  if (subset.length < count) {
    const anyDiff = pool.filter(q => (topic==='mixed' ? true : q.topic===topic));
    subset = subset.concat(shuffle(anyDiff).slice(0, count - subset.length));
  }
  return shuffle(subset).slice(0, count).map(q => ({...q}));
}

// live-clamp the number input so it never falls below 3 or above 20
function clampCountInput() {
  const n = parseInt(els.count.value, 10);
  const fixed = clamp(isFinite(n) ? n : 8, 3, 20);
  if (String(n) !== String(fixed)) els.count.value = fixed;
}
['input','change','blur'].forEach(evt => els.count.addEventListener(evt, clampCountInput));

// ==============================
// Build Questions
// ==============================
async function buildQuestions(topic, difficulty, count) {
  if (!els.aimode.checked) return sampleQuestions(topic, difficulty, count);

  try {
    const res = await fetch('/api/generate-questions', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic, difficulty, count })
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!Array.isArray(data?.questions)) throw new Error('Bad payload');
    const normalized = data.questions.map(q => ({
      topic: topic === 'mixed' ? (q.topic || 'basics') : topic,
      difficulty,
      q: String(q.q || q.question || ''),
      choices: Array.isArray(q.choices) ? q.choices.slice(0,4) : [],
      answer: Number.isInteger(q.answer) ? q.answer : 0,
      explain: String(q.explain || q.explanation || '')
    })).filter(q => q.q && q.choices.length >= 2);

    if (normalized.length < count) {
      const fallback = sampleQuestions(topic, difficulty, count - normalized.length);
      return shuffle(normalized.concat(fallback)).slice(0, count);
    }
    return normalized.slice(0, count);
  } catch (e) {
    console.warn('AI fetch failed, using local bank:', e);
    return sampleQuestions(topic, difficulty, count);
  }
}

// ==============================
// Game Flow
// ==============================
function startGame(questions) {
  game = {
    questions,
    i: 0,
    score: 0,
    answered: new Array(questions.length).fill(false),
    skipped: new Set()
  };
  els.badge.textContent = `${TOPIC_LABELS[els.topic.value]} • ${els.difficulty.value}`;
  els.progressFill.style.width = '0%';
  els.progressText.textContent = `Question 1 of ${questions.length}`;
  els.setup.hidden = true;
  els.result.hidden = true;
  els.quiz.hidden = false;
  renderCurrent();
}

function renderCurrent() {
  const q = game.questions[game.i];
  els.qtext.textContent = q.q;
  els.answers.innerHTML = '';

  q.choices.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.textContent = c;
    btn.setAttribute('data-index', idx);
    els.answers.appendChild(btn);
  });

  els.explain.hidden = true;
  els.explain.innerHTML = '';
  els.next.disabled = true;
  els.skip.disabled = false;

  const progressPct = ((game.i) / game.questions.length) * 100;
  els.progressFill.style.width = `${progressPct}%`;
  els.progressText.textContent = `Question ${game.i+1} of ${game.questions.length}`;
}

function handleAnswerClick(e) {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;

  const idx = parseInt(btn.getAttribute('data-index'), 10);
  const q = game.questions[game.i];
  if (game.answered[game.i]) return;

  // Tactile press
  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 150);

  const isCorrect = idx === q.answer;

  // lock the question & style all buttons
  game.answered[game.i] = true;
  [...els.answers.children].forEach((b, i) => {
    const className = i === q.answer ? 'correct' : (i === idx ? 'incorrect' : null);
    if (className) b.classList.add(className);
    b.disabled = true;
  });

  //
