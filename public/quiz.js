// ==============================================
// Employee Benefits Quiz Engine (Concept-first Dedupe)
// - Prefers concept-level uniqueness; falls back to text-level to fill to the requested count (max 100)
// - Works with banks WITH or WITHOUT explicit "concept" field
// - AI + local banks; robust scoring; PDF summary
// - Friendly validation for missing/invalid "Number of Questions"
// ==============================================

const TOPIC_LABELS = {
  basics: 'Basics',
  ancillary: 'Ancillary',
  funding: 'Funding',
  compliance: 'Compliance',
  sales: 'Sales',
  mixed: 'Mixed'
};

// Fallback used only if a bank can’t be loaded
const FALLBACK = [
  { topic:'basics', difficulty:'easy',
    q:"What does a health plan deductible represent?",
    choices:["The fixed amount paid per doctor visit","The maximum you’ll pay in a year","The amount you pay before the plan starts sharing costs","The amount the employer contributes monthly"],
    answer:2,
    explain:"The deductible is what a member pays for covered services before the plan starts sharing costs.",
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
    explain:"Avoidable ER spikes often flag access or adherence gaps to target.",
    why:"Targeting clinical drivers can bend trend without blunt cost shifting." },
];

// ---------- DOM refs & state ----------
const els = {};
let game = null;

// ---------- Utils ----------
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const shuffle = (arr) => arr.map(v=>[Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
const norm = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const keyText = q => `${q.topic}¦${norm(q.q)}`;
const keyExact = q => `${q.topic}¦${String(q.q)}¦${(q.choices||[]).join('¦')}`;

// Concept key: prefer q.concept; else derive from explanation + correct answer (stable)
function derivedConceptKey(q) {
  if (q.concept) return String(q.concept);
  const correct = (q.choices && Number.isInteger(q.answer) && q.choices[q.answer]) ? q.choices[q.answer] : '';
  return `${q.topic}¦${q.difficulty}¦${norm(q.explain)}¦${norm(correct)}`;
}
const keyConcept = q => derivedConceptKey(q);

// Generic dedupe helper
function dedupe(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const k = keyFn(it);
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}
const dedupeExact     = (items) => dedupe(items, keyExact);
const dedupeByText    = (items) => dedupe(items, keyText);
const dedupeByConcept = (items) => dedupe(items, keyConcept);

// Top-up to exact count while enforcing concept & text uniqueness
function topUpUniqueByConcept(base, pool, desiredCount) {
  const out = base.slice();
  const usedConcepts = new Set(out.map(keyConcept));
  const usedTexts    = new Set(out.map(keyText));
  for (const q of shuffle(pool)) {
    if (out.length >= desiredCount) break;
    const kc = keyConcept(q), kt = keyText(q);
    if (!usedConcepts.has(kc) && !usedTexts.has(kt)) {
      usedConcepts.add(kc); usedTexts.add(kt); out.push(q);
    }
  }
  return out.slice(0, desiredCount);
}

// Relaxer: if concept-unique couldn’t fill, fall back to text-only uniqueness to fill to requested count
function topUpUniqueByText(base, pool, desiredCount) {
  const out = base.slice();
  const usedTexts = new Set(out.map(keyText));
  for (const q of shuffle(pool)) {
    if (out.length >= desiredCount) break;
    const kt = keyText(q);
    if (!usedTexts.has(kt)) { usedTexts.add(kt); out.push(q); }
  }
  return out.slice(0, desiredCount);
}

// Shuffle choices and recompute correct index (safe)
function shuffleChoices(q) {
  const choices = Array.isArray(q.choices) ? q.choices.slice(0,4) : [];
  const correctIndex = Number.isInteger(q.answer) ? q.answer : 0;
  const pairs = choices.map((c,i)=>({c,i}));
  const s = shuffle(pairs);
  const shuffledChoices = s.map(p=>p.c);
  const newAnswerIndex = s.findIndex(p=>p.i === correctIndex);
  const safeAnswer = newAnswerIndex >= 0 ? newAnswerIndex : 0;
  return { ...q, choices: shuffledChoices, answer: safeAnswer };
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

// ---------- Data loading ----------
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
      if (r.status === 'fulfilled' && r.value.ok) {
        try { const arr = await r.value.json(); if (Array.isArray(arr)) items = items.concat(arr); } catch {}
      }
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

// ---------- Builders ----------
function buildLocalSet(topic, difficulty, count, pool) {
  const inTopic = pool.filter(q => topic === 'mixed' ? true : q.topic === topic);

  // Groom pool: remove exact dupes, then de-dup by concept first
  const groomed = dedupeExact(inTopic);
  const currentDiff = groomed.filter(q => q.difficulty === difficulty);
  const conceptUniqueForDiff = dedupeByConcept(currentDiff);

  // Progressive mix (harder % by difficulty)
  const harder = { easy:'intermediate', intermediate:'expert', expert:'expert' }[difficulty];
  const hardShare = { easy:0.25, intermediate:0.50, expert:1.0 }[difficulty];
  const needHard    = Math.floor(count * hardShare);
  const needPrimary = count - needHard;

  const harderPool  = dedupeByConcept(groomed.filter(q => q.difficulty === harder));

  let selected = [];
  selected = selected.concat(shuffle(conceptUniqueForDiff).slice(0, needPrimary));
  selected = selected.concat(shuffle(harderPool).slice(0, needHard));
  selected = dedupeByText(dedupeByConcept(selected));

  // Top up with concept-unique from the whole in-topic set
  const allConceptUnique = dedupeByConcept(dedupeByText(groomed));
  selected = topUpUniqueByConcept(selected, allConceptUnique, count);

  // If still short, relax to text-level uniqueness to fill
  if (selected.length < count) {
    const textUnique = dedupeByText(dedupeExact(inTopic));
    selected = topUpUniqueByText(selected, textUnique, count);
  }

  // Final shuffle & choice shuffle
  return shuffle(selected).map(shuffleChoices);
}

async function buildQuestions(topic, difficulty, count) {
  if (!els.aimode.checked) {
    const pool = await fetchBank(topic);
    return buildLocalSet(topic, difficulty, count, pool);
  }

  // AI mode
  try {
    const res = await fetch('/api/generate-questions', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic, difficulty, count })
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (!Array.isArray(data?.questions)) throw new Error('Bad payload');

    let aiQs = data.questions.map(q => ({
      topic: topic === 'mixed' ? (q.topic || 'basics') : topic,
      difficulty,
      q: String(q.q || q.question || '').trim(),
      choices: Array.isArray(q.choices) ? q.choices.slice(0,4) : [],
      answer: Number.isInteger(q.answer) ? q.answer : 0,
      explain: String(q.explain || q.explanation || ''),
      why: q.why ? String(q.why) : null,
      concept: q.concept ? String(q.concept) : undefined
    })).filter(q => q.q && q.choices.length >= 2);

    // concept-first dedupe
    aiQs = dedupeByText(dedupeByConcept(dedupeExact(aiQs))).map(shuffleChoices);

    if (aiQs.length < count) {
      const pool = await fetchBank(topic);
      const localFill = buildLocalSet(topic, difficulty, count, pool);
      let merged = dedupeByText(dedupeByConcept(dedupeExact(aiQs.concat(localFill))));

      // Top up by concept from all local
      const allConceptUnique = dedupeByConcept(dedupeByText(dedupeExact(pool)));
      merged = topUpUniqueByConcept(merged, allConceptUnique, count);

      // If still short, relax to text-level
      if (merged.length < count) {
        const textUnique = dedupeByText(dedupeExact(pool));
        merged = topUpUniqueByText(merged, textUnique, count);
      }

      return shuffle(merged).slice(0, count);
    }
    return shuffle(aiQs).slice(0, count);

  } catch (e) {
    console.warn('AI fetch failed, using local bank:', e);
    const pool = await fetchBank(topic);
    return buildLocalSet(topic, difficulty, count, pool);
  }
}

// ---------- UI / Flow ----------
function startGame(questions) {
  game = {
    questions: questions.map(q => ({...q, userAnswer: null, correct: null})),
    i: 0,
    score: 0, // live score; final recomputed at finish
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
    btn.type = 'button';
    btn.textContent = c;
    btn.setAttribute('data-index', String(idx));
    els.answers.appendChild(btn);
  });

  els.explain.hidden = true; els.explain.innerHTML = '';
  els.why.hidden = true; els.why.innerHTML = '';
  els.next.disabled = true; els.skip.disabled = false;

  const pct = ((game.i) / game.questions.length) * 100;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `Question ${game.i+1} of ${game.questions.length}`;
}

function handleAnswerClick(e) {
  const btn = e.target.closest('button[data-index]');
  if (!btn || !game) return;

  const idx = Number(btn.getAttribute('data-index'));
  if (!Number.isInteger(idx)) return;

  const q = game.questions[game.i];
  if (!q || game.answered[game.i]) return;

  btn.classList.add('clicked');
  setTimeout(() => btn.classList.remove('clicked'), 120);

  const isCorrect = Number.isInteger(q.answer) && idx === q.answer;
  game.answered[game.i] = true;
  q.userAnswer = idx;
  q.correct = !!isCorrect;

  [...els.answers.children].forEach((b, i) => {
    const cls = i === q.answer ? 'correct' : (i === idx ? 'incorrect' : '');
    if (cls) b.classList.add(cls);
    b.disabled = true;
  });

  const chosen = q.choices[idx] ?? '';
  const correct = q.choices[q.answer] ?? '';
  els.explain.innerHTML = isCorrect
    ? `✅ <strong>Correct.</strong> ${q.explain || ''}`
    : `❌ <strong>Incorrect.</strong> You selected “${chosen}.”<br><br>✅ <strong>Correct answer:</strong> “${correct}.”<br>${q.explain || ''}`;
  els.explain.hidden = false;

  const why = q.why || defaultWhy(q.topic);
  if (why) { els.why.textContent = `Why this matters: ${why}`; els.why.hidden = false; }

  if (isCorrect) game.score++;
  if (!game.perTopic[q.topic]) game.perTopic[q.topic] = { total:0, correct:0 };
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

function computeFinalScore() {
  if (!game?.questions) return 0;
  return game.questions.reduce((acc, q) => acc + (q.correct ? 1 : 0), 0);
}

function finish() {
  els.quiz.hidden = true;

  const total = game.questions.length;
  const finalScore = computeFinalScore();
  const pct = Math.round((finalScore/total)*100);

  let title = 'Benefits Explorer';
  if (pct >= 90) title = 'Benefits Pro';
  else if (pct >= 75) title = 'Advisor-in-Training';
  else if (pct >= 60) title = 'Getting There';
  else title = 'Needs Enrollment Counseling 🙂';

  game.finishedAt = new Date();

  els.resultBadge.textContent = title;
  els.resultScore.textContent = `${finalScore} / ${total} • ${pct}%`;
  els.resultNote.textContent = pct >= 75 ? 'Strong grasp of concepts — nicely done!' : 'Keep going — try a different topic or difficulty.';
  const meta = document.getElementById('resultMeta');
  if (meta) meta.textContent = `Completed on ${game.finishedAt.toLocaleString()}`;

  buildPrintableSummary(finalScore, total, pct);
  els.result.hidden = false;
}

// Coaching text for printout
function coachingAdvice(perTopic) {
  const entries = Object.entries(perTopic).map(([topic, s]) => {
    const pct = s.total ? (s.correct/s.total) : 0;
    return { topic, ...s, pct };
  }).sort((a,b)=>a.pct - b.pct);

  const lines = [];
  if (!entries.length) return 'Answer a few questions to get targeted coaching.';

  const map = {
    basics: 'Revisit HDHP/HSA rules, OOPM vs deductible, and formularies. Use simple examples during education.',
    ancillary: 'Emphasize preventive dental/vision, LTD/Life taxability, and when EAP or indemnity applies.',
    funding: 'Review specific vs aggregate stop-loss and attachment points; model level-funded surplus/deficit scenarios.',
    compliance: 'Tighten COBRA timelines, ERISA fiduciary awareness, and MHPAEA/NQTL basics to reduce risk.',
    sales: 'Deepen discovery, steerage framing (quality + navigation), and claims analytics to support ROI stories.'
  };

  entries.slice(0,2).forEach(e => {
    lines.push(`• ${TOPIC_LABELS[e.topic]}: ${map[e.topic] || 'Focus training on key fundamentals and real scenarios.'}`);
  });

  return lines.join('\n');
}

function buildPrintableSummary(score, total, pct) {
  const container = els.printable;
  if (!container) return;
  container.innerHTML = '';
  container.hidden = false;

  const ts = game.finishedAt ? game.finishedAt.toLocaleString() : new Date().toLocaleString();

  const header = document.createElement('div');
  header.innerHTML = `
    <h1>Employee Benefits Quiz — Summary</h1>
    <div class="meta"><strong>Completed:</strong> ${ts} •
      <strong>Mode:</strong> ${els.aimode?.checked ? 'AI' : 'Local'} •
      <strong>Topic:</strong> ${TOPIC_LABELS[els.topic.value]} •
      <strong>Difficulty:</strong> ${els.difficulty.value} •
      <strong>Score:</strong> ${score}/${total} (${pct}%)
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

// Inline notice if >100 or not enough uniques
function ensureCountOrNotify(finalQs, requested, availableByConcept) {
  const bar = document.querySelector('.progress-bar');
  const existing = document.getElementById('countNotice');
  if (existing) existing.remove();

  const note = document.createElement('div');
  note.id = 'countNotice';
  note.style.cssText = 'margin:.5rem 0 0; color:#b45309; font-size:.9rem;';

  if (requested > 100) {
    note.textContent = `Up to 100 questions are allowed per quiz. Reduced to 100.`;
    bar?.after(note);
  } else if (finalQs.length < requested) {
    note.textContent = `Only ${finalQs.length} unique concepts available (requested ${requested}). Pool concepts: ${availableByConcept}. Added text-unique questions to fill.`;
    bar?.after(note);
  }
}

// ---- Friendly count validation helpers ----
function showCountError(msg) {
  // Place a small inline message right below the count input
  let err = document.getElementById('countInputError');
  if (!err) {
    err = document.createElement('div');
    err.id = 'countInputError';
    err.style.cssText = 'margin-top:6px;color:#b91c1c;font-size:.9rem;';
    const parentLabel = els.count.closest('label') || els.count.parentElement;
    parentLabel.appendChild(err);
  }
  err.textContent = msg;
  // visual nudge on the input
  els.count.style.outline = '2px solid #fca5a5';
  els.count.style.outlineOffset = '2px';
}
function clearCountError() {
  const err = document.getElementById('countInputError');
  if (err) err.remove();
  els.count.style.outline = '';
  els.count.style.outlineOffset = '';
}

// ---------- Start / Init ----------
async function handleStart() {
  // Validate "Number of Questions"
  const raw = (els.count.value || '').trim();
  if (raw === '') {
    showCountError('Please enter how many questions (1–100) to start.');
    els.count.focus();
    return;
  }

  let requested = parseInt(raw, 10);
  if (!isFinite(requested) || requested < 1) {
    showCountError('Enter a whole number between 1 and 100.');
    els.count.focus();
    return;
  }
  clearCountError();

  let count = clamp(requested, 1, 100); // hard cap 100
  els.count.value = Math.min(requested, 100);

  const topic = els.topic.value;
  const diff = els.difficulty.value;

  els.start.disabled = true;
  els.start.textContent = 'Building questions...';

  // For notice: how many unique concepts are in the pool?
  let availableByConcept = 0;
  try {
    const pool = await fetchBank(topic);
    const inTopic = pool.filter(q => topic === 'mixed' ? true : q.topic === topic);
    const byDiff = inTopic.filter(q => q.difficulty === diff);
    availableByConcept = dedupeByConcept(dedupeExact(byDiff)).length;
  } catch {}

  const qs = await buildQuestions(topic, diff, count);

  els.start.disabled = false;
  els.start.textContent = 'Start Quiz';

  ensureCountOrNotify(qs, requested, availableByConcept);
  startGame(qs);
}

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

  // Wire events
  els.start.addEventListener('click', handleStart);
  els.answers.addEventListener('click', handleAnswerClick);
  els.next.addEventListener('click', nextQuestion);
  els.skip.addEventListener('click', skipQuestion);
  els.retry.addEventListener('click', () => { els.result.hidden = true; els.setup.hidden = false; });
  els.share.addEventListener('click', async () => {
    const when = game?.finishedAt ? game.finishedAt.toLocaleString() : new Date().toLocaleString();
    const text = `I scored ${els.resultScore.textContent} on the Employee Benefits Quiz (${els.badge.textContent}) — ${when}. Try to beat me!`;
    try {
      await navigator.clipboard.writeText(text);
      els.share.textContent = 'Copied!';
      setTimeout(() => els.share.textContent = 'Copy Share Text', 1500);
    } catch { alert(text); }
  });
  els.downloadPdf.addEventListener('click', () => {
    if (els.printable.innerHTML.trim() === '') {
      const total = game?.questions?.length || 0;
      const score = computeFinalScore();
      const pct = total ? Math.round((score/total)*100) : 0;
      buildPrintableSummary(score, total, pct);
    }
    els.printable.hidden = false;
    window.print();
    setTimeout(() => { els.printable.hidden = true; }, 200);
  });
  els.backSetup.addEventListener('click', () => { els.quiz.hidden = true; els.setup.hidden = false; });

  // Clear inline error as soon as user types a valid value
  els.count.addEventListener('input', () => {
    const raw = (els.count.value || '').trim();
    const n = parseInt(raw, 10);
    if (raw !== '' && isFinite(n) && n >= 1 && n <= 100) clearCountError();
  });
}

document.addEventListener('DOMContentLoaded', init);
