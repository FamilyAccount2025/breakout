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
// Utility Functions
// ==============================
function shuffle(arr) {
  return arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
}

function sampleQuestions(topic, difficulty, count, pool=BANK) {
  let subset = pool.filter(q => (topic==='mixed' ? true : q.topic===topic) && q.difficulty===difficulty);
  if (subset.length < count) {
    const anyDiff = pool.filter(q => (topic==='mixed' ? true : q.topic===topic));
    subset = subset.concat(shuffle(anyDiff).slice(0, count - subset.length));
  }
  return shuffle(subset).slice(0, count).map(q => ({...q}));
}

// ==============================
// Game Flow
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
    btn.addEventListener('click', () => selectAnswer(idx));
    els.answers.appendChild(btn);
  });

  els.explain.hidden = true;
  els.next.disabled = true;
  els.skip.disabled = false;

  const progressPct = ((game.i) / game.questions.length) * 100;
  els.progressFill.style.width = `${progressPct}%`;
  els.progressText.textContent = `Question ${game.i+1} of ${game.questions.length}`;
}

function selectAnswer(idx) {
  const q = game.questions[game.i];
  if (game.answered[game.i]) return;
  game.answered[game.i] = true;

  const correct = idx === q.answer;
  if (correct) game.score++;

  [...els.answers.children].forEach((btn, i) => {
    btn.classList.add(i === q.answer ? 'correct' : (i === idx ? 'incorrect' : ''));
    btn.disabled = true;
  });

  els.explain.textContent = q.explain || '';
  els.explain.hidden = false;
  els.next.disabled = false;
  els.skip.disabled = true;
}

function nextQuestion() {
  if (game.i < game.questions.length - 1) {
    game.i++;
    renderCurrent();
  } else if (game.skipped.size > 0) {
    game.i = [...game.skipped][0];
    game.skipped.delete(game.i);
    renderCurrent();
  } else {
    finish();
  }
}

function skipQuestion() {
  if (!game.answered[game.i]) game.skipped.add(game.i);
  nextQuestion();
}

function finish() {
  els.quiz.hidden = true;
  const total = game.questions.length;
  const pct = Math.round((game.score/total)*100);
  let title = 'Benefits Explorer';
  if (pct >= 90) title = 'Benefits Pro';
  else if (pct >= 75) title = 'Advisor-in-Training';
  else if (pct >= 60) title = 'Getting There';
  else title = 'Needs Enrollment Counseling 🙂';
  els.resultBadge.textContent = title;
  els.resultScore.textContent = `${game.score} / ${total} • ${pct}%`;
  els.resultNote.textContent = pct >= 75 ? 'Strong grasp of concepts — nicely done!' : 'Keep going — try a different topic or difficulty.';
  els.result.hidden = false;
}

// ==============================
// Event Listeners
// ==============================
els.start.addEventListener('click', async () => {
  const topic = els.topic.value;
  const diff = els.difficulty.value;
  const count = Math.min(20, Math.max(3, parseInt(els.count.value||8,10)));
  els.start.disabled = true;
  els.start.textContent = 'Building questions...';
  const qs = await buildQuestions(topic, diff, count);
  els.start.disabled = false;
  els.start.textContent = 'Start Quiz';
  startGame(qs);
});

els.next.addEventListener('click', nextQuestion);
els.skip.addEventListener('click', skipQuestion);

els.retry.addEventListener('click', () => {
  els.result.hidden = true;
  els.setup.hidden = false;
});

els.share.addEventListener('click', async () => {
  const text = `I scored ${els.resultScore.textContent} on the Employee Benefits Quiz (${els.badge.textContent}). Try to beat me!`;
  try {
    await navigator.clipboard.writeText(text);
    els.share.textContent = 'Copied!';
    setTimeout(() => els.share.textContent = 'Copy Share Text', 1500);
  } catch {
    alert(text);
  }
});

els.backSetup.addEventListener('click', () => {
  els.quiz.hidden = true;
  els.setup.hidden = false;
});
