// ==============================
// Local Question Bank (fallback)
// ==============================
const BANK = [
  {
    topic:'basics',
    difficulty:'easy',
    q:'What does a health plan deductible represent?',
    choices:[
      'The fixed amount paid per doctor visit',
      'The maximum you’ll pay in a year',
      'The amount you pay before the plan starts sharing costs',
      'The amount the employer contributes monthly'
    ],
    answer:2,
    explain:'The deductible is the amount a member pays for covered services before the plan starts sharing costs (coinsurance).',
    why:'Deductibles drive member cost exposure and plan design trade-offs; knowing them helps employees forecast out-of-pocket expenses.'
  },
  {
    topic:'ancillary',
    difficulty:'easy',
    q:'Which is commonly an ancillary benefit?',
    choices:['Dental','Inpatient surgery','Hospital room and board','Chemotherapy'],
    answer:0,
    explain:'Ancillary benefits commonly include dental, vision, life, and disability.',
    why:'Ancillary benefits round out total compensation, boosting retention and supporting preventive care.'
  },
  {
    topic:'funding',
    difficulty:'easy',
    q:'What’s a common appeal of a level-funded plan for small employers?',
    choices:['No stop-loss needed','Potential refund if claims are low','Guaranteed renewals for 10 years','Exemption from ACA mandates'],
    answer:1,
    explain:'Level-funded arrangements may return surplus if claims run favorably; ACA rules still apply.',
    why:'Funding models impact cash flow and risk; understanding them enables smarter budget planning.'
  },
  {
    topic:'compliance',
    difficulty:'easy',
    q:'COBRA primarily provides what?',
    choices:['Subsidized coverage for low-income individuals','Continuation of employer-sponsored coverage after qualifying events','Medicare enrollment assistance','A federal premium tax credit'],
    answer:1,
    explain:'COBRA allows qualified beneficiaries to continue employer coverage after certain events (e.g., termination).',
    why:'Compliance errors are costly; COBRA basics protect both employer and employees during transitions.'
  },
  {
    topic:'sales',
    difficulty:'easy',
    q:'What’s a common first-step in a broker’s discovery with a new group?',
    choices:['Presenting final rates immediately','Understanding current pain points and objectives','Requesting a 5-year rate guarantee','Quoting only one carrier'],
    answer:1,
    explain:'A consultative approach starts with discovery to align solutions with the employer’s objectives and challenges.',
    why:'Discovery reveals cost drivers and culture fit, leading to better outcomes and smoother renewals.'
  }
];

const TOPIC_LABELS = {
  basics: 'Basics', ancillary: 'Ancillary', funding: 'Funding', compliance: 'Compliance', sales: 'Sales', mixed: 'Mixed'
};

// ==============================
// State & Elements
// ==============================
const els = {};

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

function defaultWhy(topic) {
  switch(topic) {
    case 'basics': return 'Grasping core plan mechanics builds confidence during enrollment and care decisions.';
    case 'ancillary': return 'Ancillary benefits strengthen total rewards and support preventive well-being.';
    case 'funding': return 'Funding choices shape risk tolerance, cash flow, and long-term cost control.';
    case 'compliance': return 'Compliance protects the organization from penalties and safeguards employees.';
    case 'sales': return 'Consultative benefits strategy improves adoption, value, and retention.';
    default: return 'This concept connects directly to real-world coverage, cost, and employee experience.';
  }
}

// ==============================
// Build Questions
// ==============================
async function buildQuestions(topic, difficulty, count) {
  const useAI = els.aimode.checked;
  if (!useAI) return sampleQuestions(topic, difficulty, count);

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
      explain: String(q.explain || q.explanation || ''),
      why: q.why ? String(q.why) : null
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
  els.why.hidden = true;
  els.why.innerHTML = '';

  els.next.disabled = true;
  els.skip.disabled = false;

  const progressPct = ((game.i) / game.questions.length) * 100;
  els.progressFill.style.width = `${progressPct}%`;
  els.progressText.textContent = `Question ${game.i+1} of ${game.questions.length}`;
}

function handleAnswerClick(e) {
  const btn = e.target.closest('button[data-index]');
  if (!btn || !game) return;

  const idx = parseInt(btn.getAttribute('data-index'), 10);
  const q = game.questions[game.i];
  if (game.answered[game.i]) return;

  // Tactile press
  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 150);

  const isCorrect = idx === q.answer;

  // lock question & style all buttons
  game.answered[game.i] = true;
  [...els.answers.children].forEach((b, i) => {
    const className = i === q.answer ? 'correct' : (i === idx ? 'incorrect' : null);
    if (className) b.classList.add(className);
    b.disabled = true;
  });

  // Coaching explanation + why it matters
  const chosen = q.choices[idx];
  const correct = q.choices[q.answer];

  if (isCorrect) {
    els.explain.innerHTML = `✅ <strong>Correct.</strong> ${q.explain || ''}`;
  } else {
    els.explain.innerHTML = `❌ <strong>Incorrect.</strong> You selected “${chosen}.”<br><br>` +
      `✅ <strong>Correct answer:</strong> “${correct}.”<br>` +
      (q.explain ? `${q.explain}` : '');
  }
  els.explain.hidden = false;

  const why = q.why || defaultWhy(q.topic);
  if (why) {
    els.why.textContent = `Why this matters: ${why}`;
    els.why.hidden = false;
  }

  // controls
  els.next.disabled = false;
  els.skip.disabled = true;

  if (isCorrect) game.score++;
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
// Init / Events
// ==============================
function init() {
  // Cache elements once
  els.setup = document.getElementById('setup');
  els.quiz = document.getElementById('quiz');
  els.result = document.getElementById('result');

  els.topic = document.getElementById('topic');
  els.difficulty = document.getElementById('difficulty');
  els.count = document.getElementById('count');
  els.aimode = document.getElementById('aimode');
  els.start = document.getElementById('start');

  els.badge = document.getElementById('badge');
  els.progressText = document.getElementById('progress');
  els.progressFill = document.getElementById('progressFill');
  els.qtext = document.getElementById('qtext');
  els.answers = document.getElementById('answers');
  els.explain = document.getElementById('explain');
  els.why = document.getElementById('why');

  els.next = document.getElementById('next');
  els.skip = document.getElementById('skip');
  els.backSetup = document.getElementById('backSetup');

  els.resultBadge = document.getElementById('resultBadge');
  els.resultScore = document.getElementById('resultScore');
  els.resultNote = document.getElementById('resultNote');
  els.retry = document.getElementById('retry');
  els.share = document.getElementById('share');

  // Events
  els.start.addEventListener('click', async () => {
    let requested = parseInt(els.count.value, 10);
    if (!isFinite(requested)) requested = 1;    // if empty or invalid, default to 1
    const count = clamp(requested, 1, 20);
    els.count.value = count; // reflect clamp

    const topic = els.topic.value;
    const diff = els.difficulty.value;

    els.start.disabled = true;
    els.start.textContent = 'Building questions...';
    const qs = await buildQuestions(topic, diff, count);
    els.start.disabled = false;
    els.start.textContent = 'Start Quiz';
    startGame(qs);
  });

  els.answers.addEventListener('click', handleAnswerClick);
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
}

document.addEventListener('DOMContentLoaded', init);
