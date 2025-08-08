// ==============================
// Dynamic Local Banks (JSON) + AI mode
// No duplicates per quiz + Printable PDF summary + Timestamp
// ==============================

const TOPIC_LABELS = {
  basics: 'Basics',
  ancillary: 'Ancillary',
  funding: 'Funding',
  compliance: 'Compliance',
  sales: 'Sales',
  mixed: 'Mixed'
};

// Fallback (if JSON missing)
const FALLBACK = [
  { topic:'basics', difficulty:'easy',
    q:"What does a health plan deductible represent?",
    choices:["The fixed amount paid per doctor visit","The maximum you’ll pay in a year","The amount you pay before the plan starts sharing costs","The amount the employer contributes monthly"],
    answer:2,
    explain:"The deductible is what a member pays for covered services before the plan starts sharing costs (coinsurance).",
    why:"Deductibles shape member cost exposure and influence plan selection." },
  { topic:'ancillary', difficulty:'easy',
    q:"Which is commonly an ancillary benefit?",
    choices:["Dental","Inpatient surgery","Hospital room and board","Chemotherapy"],
    answer:0,
    explain:"Ancillary benefits commonly include dental, vision, life, and disability.",
    why:"Ancillary benefits round out total rewards and improve retention." },
  { topic:'funding', difficulty:'intermediate',
    q:"In self-funded plans, which layer primarily protects the plan from a single high-cost claimant?",
    choices:["Aggregate stop-loss","Specific stop-loss","Administrative services only (ASO) fee","Pooling charge on fully insured"],
    answer:1,
    explain:"Specific stop-loss caps exposure from a single claimant; aggregate caps total claims.",
    why:"Choosing correct attachment points is critical to risk management." },
  { topic:'compliance', difficulty:'easy',
    q:"COBRA primarily provides what?",
    choices:["Subsidized coverage for low-income individuals","Continuation of employer coverage after qualifying events","Medicare enrollment assistance","A federal premium tax credit"],
    answer:1,
    explain:"COBRA allows qualified beneficiaries to continue employer coverage after certain events.",
    why:"COBRA compliance protects employers from penalties and employees from gaps." },
  { topic:'sales', difficulty:'intermediate',
    q:"Which metric best signals an opportunity for condition-management programs?",
    choices:["High generic dispense rate","Rising avoidable ER utilization","Stable preventive visit rates","Low telehealth adoption"],
    answer:1,
    explain:"Avoidable ER spikes often flag gaps in primary care access or adherence—ripe for management.",
    why:"Targeting clinical drivers can bend trend without blunt cost shifting." },
];

// Elements & state
const els = {};
let game = null;

// Utils
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function shuffle(arr) { return arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]); }
const pick = (arr, n) => (n <= 0 ? [] : (arr.length <= n ? shuffle(arr.slice()) : shuffle(arr).slice(0, n)));
const qKey = (q) => `${q.topic}|${q.difficulty}|${q.q}|${(q.choices||[]).join('¦')}`;
function dedupeByKey(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = qKey(it);
    if (!seen.has(key)) { seen.add(key); out.push(it); }
  }
  return out;
}

// shuffle a question’s choices & recompute the correct index
function shuffleChoices(q) {
  const pairs = q.choices.map((c,i)=>({c,i}));
  const shuffled = shuffle(pairs);
  const choices = shuffled.map(p=>p.c);
  const answerIndex = shuffled.findIndex(p=>p.i===q.answer);
  return { ...q, choices, answer: answerIndex };
}

function defaultWhy(topic) {
  switch(topic) {
    case 'basics': return 'Grasping core plan mechanics builds confidence during enrollment and care decisions.';
    case 'ancillary': return 'Ancillary benefits strengthen total rewards and support preventive well-being.';
    case 'funding': return 'Funding choices shape risk tolerance, cash flow, and long-term cost control.';
    case 'compliance': return 'Compliance protects the organization from penalties and safeguards employees.';
    case 'sales': return 'Consultative strategy improves adoption, value, and retention.';
    default: return 'This concept connects directly to real-world coverage, cost, and employee experience.';
  }
}

// Load local banks
async function fetchBank(topic) {
  const files = {
    basics: '/data/bank.basics.json',
    ancillary: '/data/bank.ancillary.json',
    funding: '/data/bank.funding.json',
    compliance: '/data/bank.compliance.json',
    sales: '/data/bank.sales.json'
  };
  if (topic === 'mixed') {
    const urls = Object.values(files);
    const results = await Promise.allSettled(urls.map(u => fetch(u, {cache:'no-store'})));
    let items = [];
    for (const r of results) {
      try {
        if (r.status === 'fulfilled' && r.value.ok) {
          const arr = await r.value.json();
          if (Array.isArray(arr)) items = items.concat(arr);
        }
      } catch {}
    }
    return items.length ? items : FALLBACK.slice();
  }
  const url = files[topic];
  if (!url) return FALLBACK.slice();
  try {
    const res = await fetch(url, {cache:'no-store'});
    if (!res.ok) throw new Error('missing bank');
    const arr = await res.json();
    return Array.isArray(arr) && arr.length ? arr : FALLBACK.slice();
  } catch {
    return FALLBACK.slice();
  }
}

// Build local set with difficulty mixing (and dedupe)
function buildLocalSet(topic, difficulty, count, pool) {
  const inTopic = pool.filter(q => topic === 'mixed' ? true : q.topic === topic);

  const harder = { easy: 'intermediate', intermediate: 'expert', expert: 'expert' }[difficulty];
  const hardShare = { easy: 0.25, intermediate: 0.50, expert: 1.0 }[difficulty];

  const needHard = Math.floor(count * hardShare);
  const needPrimary = count - needHard;

  const primaryPool = inTopic.filter(q => q.difficulty === difficulty);
  const harderPool = inTopic.filter(q => q.difficulty === harder);

  let selected = [];
  selected = selected.concat(pick(harderPool, needHard));
  selected = selected.concat(pick(primaryPool, needPrimary));

  // Backfill if short with anything in-topic
  if (selected.length < count) {
    const backup = inTopic.filter(q => !selected.includes(q));
    selected = selected.concat(pick(backup, count - selected.length));
  }

  // Dedupe, shuffle questions & choices; enforce final count
  selected = dedupeByKey(selected);
  selected = shuffle(selected).map(shuffleChoices).slice(0, count);
  return selected;
}

// AI build (shuffled + deduped with fallback)
async function buildQuestions(topic, difficulty, count) {
  if (!els.aimode.checked) {
    const pool = await fetchBank(topic);
    return buildLocalSet(topic, difficulty, count, pool);
  }
  try {
    const res = await fetch('/api/generate-questions', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic, difficulty, count })
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!Array.isArray(data?.questions)) throw new Error('Bad payload');

    let normalized = data.questions.map(q => ({
      topic: topic === 'mixed' ? (q.topic || 'basics') : topic,
      difficulty,
      q: String(q.q || q.question || ''),
      choices: Array.isArray(q.choices) ? q.choices.slice(0,4) : [],
      answer: Number.isInteger(q.answer) ? q.answer : 0,
      explain: String(q.explain || q.explanation || ''),
      why: q.why ? String(q.why) : null
    })).filter(q => q.q && q.choices.length >= 2);

    // Shuffle choices & questions
    normalized = normalized.map(shuffleChoices);
    normalized = shuffle(normalized);

    // If short, backfill locally
    if (normalized.length < count) {
      const pool = await fetchBank(topic);
      const fallback = buildLocalSet(topic, difficulty, count - normalized.length, pool);
      normalized = normalized.concat(fallback);
    }

    // Final dedupe & slice to count
    normalized = dedupeByKey(normalized).slice(0, count);
    return normalized;
  } catch (e) {
    console.warn('AI fetch failed, using local bank:', e);
    const pool = await fetchBank(topic);
    return buildLocalSet(topic, difficulty, count, pool);
  }
}

// Game flow
function startGame(questions) {
  game = {
    questions: questions.map(q => ({...q, userAnswer: null, correct: null})),
    i: 0,
    score: 0,
    answered: new Array(questions.length).fill(false),
    skipped: new Set(),
    perTopic: {},
    finishedAt: null
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

  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 150);

  const isCorrect = idx === q.answer;
  game.answered[game.i] = true;
  q.userAnswer = idx;
  q.correct = isCorrect;

  // style buttons
  [...els.answers.children].forEach((b, i) => {
    const className = i === q.answer ? 'correct' : (i === idx ? 'incorrect' : null);
    if (className) b.classList.add(className);
    b.disabled = true;
  });

  const chosen = q.choices[idx];
  const correct = q.choices[q.answer];
  if (isCorrect) {
    els.explain.innerHTML = `✅ <strong>Correct.</strong> ${q.explain || ''}`;
    game.score++;
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

  // per-topic stats
  if (!game.perTopic[q.topic]) game.perTopic[q.topic] = { total: 0, correct: 0 };
  game.perTopic[q.topic].total += 1;
  if (isCorrect) game.perTopic[q.topic].correct += 1;

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

  game.finishedAt = new Date();

  els.resultBadge.textContent = title;
  els.resultScore.textContent = `${game.score} / ${total} • ${pct}%`;
  els.resultNote.textContent = pct >= 75 ? 'Strong grasp of concepts — nicely done!' : 'Keep going — try a different topic or difficulty.';
  els.resultMeta.textContent = `Completed on ${game.finishedAt.toLocaleString()}`;

  buildPrintableSummary();
  els.result.hidden = false;
}

// Printable summary builder
function coachingAdvice(perTopic) {
  const entries = Object.entries(perTopic).map(([topic, s]) => {
    const pct = s.total ? (s.correct / s.total) : 0;
    return { topic, ...s, pct };
  }).sort((a,b)=>a.pct - b.pct);

  const lines = [];
  if (!entries.length) return 'Answer a few questions to get targeted coaching.';

  const map = {
    basics: 'Revisit HDHP/HSA rules, OOPM vs deductible, and formulary tiers. Use simple examples during employee education.',
    ancillary: 'Emphasize preventive dental/vision design, LTD/Life taxability, and when EAP or indemnity applies.',
    funding: 'Review specific vs aggregate stop-loss and attachment points; model level-funded surplus/deficit scenarios.',
    compliance: 'Tighten COBRA timelines, ERISA fiduciary awareness, and MHPAEA/NQTL basics to reduce risk.',
    sales: 'Deepen discovery, steerage framing (quality + navigation), and claims analytics to support ROI stories.'
  };

  entries.slice(0,2).forEach(e => {
    lines.push(`• ${TOPIC_LABELS[e.topic]}: ${map[e.topic] || 'Focus training on key fundamentals and real scenarios.'}`);
  });

  return lines.join('\n');
}

function buildPrintableSummary() {
  const container = els.printable;
  container.innerHTML = '';
  container.hidden = false;

  const total = game.questions.length;
  const pct = Math.round((game.score/total)*100);
  const ts = game.finishedAt ? game.finishedAt.toLocaleString() : new Date().toLocaleString();

  const header = document.createElement('div');
  header.innerHTML = `
    <h1>Employee Benefits Quiz — Summary</h1>
    <div class="meta"><strong>Completed:</strong> ${ts} •
      <strong>Mode:</strong> ${els.aimode.checked ? 'AI' : 'Local'} •
      <strong>Topic:</strong> ${TOPIC_LABELS[els.topic.value]} •
      <strong>Difficulty:</strong> ${els.difficulty.value} •
      <strong>Score:</strong> ${game.score}/${total} (${pct}%)
    </div>
  `;
  container.appendChild(header);

  const coach = document.createElement('div');
  coach.innerHTML = `<h2>Sales Coaching Advice</h2><pre class="small" style="white-space:pre-wrap;margin:0">${coachingAdvice(game.perTopic)}</pre>`;
  container.appendChild(coach);

  const h2 = document.createElement('h2');
  h2.textContent = 'Question Details';
  container.appendChild(h2);

  game.questions.forEach((q, idx) => {
    const userTxt = q.userAnswer != null ? q.choices[q.userAnswer] : '—';
    const correctTxt = q.choices[q.answer];
    const card = document.createElement('div');
    card.className = 'qcard';
    card.innerHTML = `
      <div><strong>Q${idx+1}.</strong> ${q.q}</div>
      <div class="small" style="margin-top:6px;"><strong>Your answer:</strong> ${userTxt}</div>
      <div class="small"><strong>Correct answer:</strong> ${correctTxt} ${q.correct ? '✅' : '❌'}</div>
      ${q.explain ? `<div class="small" style="margin-top:4px;"><strong>Explanation:</strong> ${q.explain}</div>` : ''}
      ${q.why ? `<div class="small"><strong>Why this matters:</strong> ${q.why}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// Init & events
function init() {
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
  els.resultMeta = document.getElementById('resultMeta');
  els.retry = document.getElementById('retry');
  els.share = document.getElementById('share');
  els.downloadPdf = document.getElementById('downloadPdf');

  els.printable = document.getElementById('printable');

  // Start Quiz
  els.start.addEventListener('click', async () => {
    let requested = parseInt(els.count.value, 10);
    if (!isFinite(requested)) requested = 1;
    const count = clamp(requested, 1, 100);
    els.count.value = count;

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
    const when = game?.finishedAt ? game.finishedAt.toLocaleString() : new Date().toLocaleString();
    const text = `I scored ${els.resultScore.textContent} on the Employee Benefits Quiz (${els.badge.textContent}) — ${when}. Try to beat me!`;
    try {
      await navigator.clipboard.writeText(text);
      els.share.textContent = 'Copied!';
      setTimeout(() => els.share.textContent = 'Copy Share Text', 1500);
    } catch {
      alert(text);
    }
  });

  els.downloadPdf.addEventListener('click', () => {
    if (els.printable.innerHTML.trim() === '') buildPrintableSummary();
    els.printable.hidden = false;
    window.print();
    setTimeout(() => { els.printable.hidden = true; }, 200);
  });

  els.backSetup.addEventListener('click', () => {
    els.quiz.hidden = true;
    els.setup.hidden = false;
  });
}

document.addEventListener('DOMContentLoaded', init);
