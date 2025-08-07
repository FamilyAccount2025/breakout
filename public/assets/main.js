/* main.js — stable canvas previews + modal logic (v5)
 * Bulletproof fade-ins (with fallback), DPR scaling, observers, reduced-motion
 * Previews: Breakout, Podcast, FAQ (click/tap flip, non-mirrored text),
 *           Chatbot (typing then show), Quiz (ring + hover/tap choices)
 */

(() => {
  "use strict";

  /* -------------------- Utilities -------------------- */
  const prefersReduced = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (!clientWidth || !clientHeight) return;
      canvas.width  = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    };
    resize();
    return { ctx, resize };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function withAlpha(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* -------------------- Animator -------------------- */
  class Animator {
    constructor(canvas, drawFrame) {
      this.canvas = canvas;
      this.drawFrame = drawFrame;
      const { ctx, resize } = setupCanvas(canvas);
      this.ctx = ctx;
      this.resizeFn = resize;
      this.running = false;
      this.frameId = null;
      this.lastTs = 0;

      // keep crisp on resize
      try {
        this.ro = new ResizeObserver(() => {
          this.resizeFn();
          if (!this.running) this.safeDraw(0, true);
        });
        this.ro.observe(canvas);
      } catch {}

      // pause when offscreen
      try {
        this.io = new IntersectionObserver(entries => {
          if (entries[0].isIntersecting) this.start();
          else this.stop();
        }, { threshold: 0.1 });
        this.io.observe(canvas);
      } catch {
        // If IO unsupported, just start
        this.start();
      }
    }
    safeDraw(dt, staticFrame) {
      try { this.drawFrame(this.ctx, dt, staticFrame); }
      catch (err) { console.error('Canvas animator error:', err); this.stop(); }
    }
    start() {
      if (this.running) return;
      if (prefersReduced) { this.safeDraw(0, true); return; }
      this.running = true;
      const loop = (ts) => {
        if (!this.running) return;
        const dt = this.lastTs ? (ts - this.lastTs) : 16;
        this.lastTs = ts;
        this.safeDraw(dt, false);
        this.frameId = requestAnimationFrame(loop);
      };
      this.frameId = requestAnimationFrame(loop);
    }
    stop() {
      this.running = false;
      this.lastTs = 0;
      if (this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    disconnect() {
      this.stop();
      try { this.ro && this.ro.disconnect(); } catch {}
      try { this.io && this.io.disconnect(); } catch {}
    }
  }

  /* -------------------- Previews -------------------- */

  // 1) Breakout
  function breakoutPreview(canvas) {
    const accent = canvas.dataset.accent || '#22d3ee';
    const state = { ball: { x: 80, y: 60, vx: 120, vy: 140, r: 6 } };
    const paddle = { w: 56, h: 7, x: 60 };

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      const phoneW = Math.min(W * 0.7, H * 0.55);
      const phoneH = phoneW * 1.8;
      const px = (W - phoneW)/2, py = (H - phoneH)/2;
      roundRectPath(ctx, px, py, phoneW, phoneH, 14);
      ctx.strokeStyle = withAlpha(accent, 0.8);
      ctx.lineWidth = 2; ctx.stroke();

      const sPad = 10;
      const sx = px + sPad, sy = py + sPad*2;
      const sw = phoneW - sPad*2, sh = phoneH - sPad*3;

      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();

      // bricks shimmer
      const rows=3, cols=6, bh=10, gap=4, bw=sw/cols;
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
        const bx=sx+c*bw+gap/2, by=sy+10+r*(bh+gap);
        roundRectPath(ctx,bx,by,bw-gap,bh,3);
        const pulse=0.6+0.4*Math.sin((Date.now()/400)+(r*cols+c));
        ctx.fillStyle=withAlpha(accent, 0.25*pulse); ctx.fill();
      }

      const seconds = staticFrame ? 0 : Math.min(dt, 32)/1000;
      state.ball.x += state.ball.vx * seconds;
      state.ball.y += state.ball.vy * seconds;

      // walls
      if (state.ball.x - state.ball.r < 0) { state.ball.x = state.ball.r; state.ball.vx *= -1; }
      if (state.ball.x + state.ball.r > sw) { state.ball.x = sw - state.ball.r; state.ball.vx *= -1; }
      if (state.ball.y - state.ball.r < 0) { state.ball.y = state.ball.r; state.ball.vy *= -1; }

      // paddle follows ball
      const target = clamp(state.ball.x - paddle.w/2, 0, sw - paddle.w);
      paddle.x += (target - paddle.x) * (staticFrame ? 1 : 8) * seconds;

      const pyP = sh - 16;
      if (state.ball.y + state.ball.r > pyP &&
          state.ball.x > paddle.x &&
          state.ball.x < paddle.x + paddle.w &&
          state.ball.vy > 0) {
        state.ball.y = pyP - state.ball.r;
        state.ball.vy *= -1;
      }
      if (state.ball.y - state.ball.r > sh) {
        state.ball.x = Math.random()*(sw*0.6)+sw*0.2;
        state.ball.y = sh*0.4;
        state.ball.vx = (Math.random()>0.5?1:-1)*(100+Math.random()*80);
        state.ball.vy = 120 + Math.random()*120;
      }

      // draw
      ctx.fillStyle = withAlpha('#fff',0.9);
      roundRectPath(ctx, sx+paddle.x, sy+pyP, paddle.w, paddle.h, 3); ctx.fill();
      ctx.beginPath(); ctx.arc(sx+state.ball.x, sy+state.ball.y, state.ball.r, 0, Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
    };
    return new Animator(canvas, draw);
  }

  // 2) Podcast bars
  function podcastPreview(canvas) {
    const accent = canvas.dataset.accent || '#f472b6';
    const bars = 7, phases = Array.from({length:bars},(_,i)=>i*0.7);
    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);
      const totalW = W*0.6;
      const barW = totalW/bars*0.6;
      const gap = (totalW/bars)-barW;
      const startX = (W-totalW)/2;
      const base = H*0.65;

      ctx.font = '12px Inter, system-ui, sans-serif';
      phases.forEach((ph,i)=>{
        const t = (Date.now()/500)+ph;
        const amp = staticFrame ? 0.4 : (0.35+0.35*Math.sin(t));
        const h = Math.max(8, H*0.4*amp);
        const x = startX + i*(barW+gap);
        ctx.fillStyle = withAlpha(accent,0.85);
        roundRectPath(ctx,x,base-h,barW,h,4);
        ctx.fill();
      });
    };
    return new Animator(canvas, draw);
  }

  // 3) FAQ — click/tap flip; slow auto-hint; TEXT NEVER MIRRORS
  function faqPreview(canvas) {
    const accent = canvas.dataset.accent || '#fde047';

    const tiles = [
      { q:'What is it?', a:'AI-driven FAQ system.' },
      { q:'How built?', a:'LLM + context index.' },
      { q:'Editable?', a:'Yes, CMS-friendly.' },
      { q:'Responsive?', a:'Mobile-first layout.' },
      { q:'Searchable?', a:'Semantic search.' },
      { q:'Branding?', a:'Themeable UI.' },
    ].map(t => ({ ...t, side: 'front', flipping:false, t:0 }));

    const cols=3, rows=2, gap=10;
    let layout = []; // bounds
    let lastAuto = 0, autoIndex = 0;
    const AUTO_DELAY = 3500;
    const FLIP_MS = 900;

    canvas.addEventListener('pointerdown', (e)=>{
      try {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const hit = layout.findIndex(b => x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h);
        if (hit>=0 && !tiles[hit].flipping) tiles[hit].flipping = true;
      } catch {}
    }, {passive:true});

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      // grid
      const tileW = (W - gap*(cols+1))/cols;
      const tileH = (H - gap*(rows+1))/rows;
      layout.length = 0;
      for (let r=0;r<rows;r++){
        for (let c=0;c<cols;c++){
          const i = r*cols + c;
          layout[i] = { x: gap + c*(tileW+gap), y: gap + r*(tileH+gap), w: tileW, h: tileH };
        }
      }

      // auto hint
      const now = performance.now();
      if (!staticFrame && now - lastAuto > AUTO_DELAY) {
        if (!tiles[autoIndex].flipping) tiles[autoIndex].flipping = true;
        autoIndex = (autoIndex+1) % tiles.length;
        lastAuto = now;
      }

      // update flip progress
      const step = prefersReduced ? 0 : (staticFrame ? 0 : dt);
      tiles.forEach(t => {
        if (t.flipping) {
          t.t += step;
          if (t.t >= FLIP_MS) {
            t.t = 0; t.flipping = false;
            t.side = (t.side === 'front') ? 'back' : 'front';
          }
        }
      });

      // draw tiles
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.font = `${Math.max(10, Math.min(14, tileW/10))}px Inter, system-ui, sans-serif`;

      tiles.forEach((tile, i) => {
        const {x,y,w,h} = layout[i];

        const p = tile.flipping ? Math.max(0, Math.min(1, tile.t / FLIP_MS)) : 0;
        const scaleX = Math.cos(p * Math.PI); // 1..0..-1
        const drawScale = Math.max(0.02, Math.abs(scaleX)); // compress only

        const showFront = p < 0.5 ? (tile.side === 'front') : (tile.side !== 'front');
        const text = showFront ? tile.q : tile.a;

        ctx.save();
        ctx.translate(x + w/2, y + h/2);

        // border uses actual flip
        ctx.save();
        ctx.scale(scaleX, 1);
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = withAlpha(accent, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();

        // clip unscaled shape
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.clip();

        // face content without mirroring text
        ctx.scale(drawScale, 1);

        if (!showFront) {
          ctx.save();
          ctx.globalAlpha = 0.12;
          roundRectPath(ctx, -w/2, -h/2, w, h, 10);
          ctx.fillStyle = accent; ctx.fill();
          ctx.restore();
        }

        ctx.fillStyle = '#e5e7eb';
        ctx.fillText(text, 0, 0, w - 18);

        ctx.restore();
      });
    };

    return new Animator(canvas, draw);
  }

  // 4) Chatbot — typing then show
  function chatbotPreview(canvas) {
    const accent = canvas.dataset.accent || '#34d399';
    const script = [
      { role:'user', text:'How was Breakout built?' },
      { role:'bot',  text:'With AI-assisted code and canvas.' },
      { role:'user', text:'Is it mobile-friendly?' },
      { role:'bot',  text:'Yes — responsive & fast.' },
    ];
    const phases = [];
    script.forEach((m, idx) => { if (m.role === 'bot') phases.push({ idx, kind:'typing' }); phases.push({ idx, kind:'show' }); });

    let phaseIdx = 0, elapsed = 0;
    const DUR = { typing: 1100, show: 1700, slide: 300 };

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      if (!staticFrame && !prefersReduced) {
        elapsed += dt;
        const cur = phases[phaseIdx];
        const curDur = DUR[cur.kind];
        if (elapsed > curDur) { elapsed = 0; phaseIdx = (phaseIdx + 1) % phases.length; }
      }

      const curPhase = phases[phaseIdx];
      const curMsgIndex = curPhase.idx;

      const start = Math.max(0, curMsgIndex - 3);
      let y = 10;
      for (let i = start; i <= curMsgIndex; i++) {
        const msg = script[i];
        const isBot = msg.role === 'bot';
        const isLatest = i === curMsgIndex;

        const showingTyping = isLatest && (curPhase.kind === 'typing') && isBot;
        const text = showingTyping ? '' : msg.text;

        const textWidth = ctx.measureText(text).width;
        const bubbleW = Math.min(W - 24, Math.max(140, textWidth + 28));
        const x = isBot ? (W - bubbleW - 12) : 12;

        let slide = 0;
        if (isLatest) {
          const t = clamp(elapsed / DUR.slide, 0, 1);
          slide = (isBot ? 1 : -1) * (1 - t) * 14;
        }

        roundRectPath(ctx, x + slide, y, bubbleW, 26, 10);
        ctx.fillStyle = isBot ? withAlpha(accent, 0.22) : withAlpha('#ffffff', 0.10);
        ctx.fill();

        ctx.fillStyle = '#e5e7eb';
        if (showingTyping && !staticFrame) {
          const cx = x + slide + bubbleW/2 - 14;
          const cy = y + 13;
          for (let d=0; d<3; d++) {
            const r = 3 + (Math.sin(Date.now()/250 + d) * 1.5 + 1.5) / 2;
            ctx.beginPath(); ctx.arc(cx + d*14, cy, r, 0, Math.PI*2); ctx.fill();
          }
        } else {
          ctx.fillText(text, x + slide + 12, y + 13);
        }

        y += 26 + 8;
      }
    };

    return new Animator(canvas, draw);
  }

  // 5) Quiz — ring + hover/tap choices
  function quizPreview(canvas) {
    const accent = canvas.dataset.accent || '#a78bfa';
    const choices = ['Premiums', 'Deductible', 'Copay', 'Out-of-Pocket'];
    let active = 0, elapsed = 0;

    const STEP_MS = 1800, SLIDE_MS = 220, PULSE_MS = 500, correctIndex = 1;

    const geom = () => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      return { W, H, cx: W*0.22, cy: H*0.5, R: Math.min(W,H)*0.18, boxX: W*0.44, boxY: H*0.22, boxW: W*0.48, lineH: 28, gap: 10 };
    };

    function indexFromPointer(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const { boxX, boxY, boxW, lineH, gap, H } = geom();
      if (x < boxX || x > boxX + boxW) return -1;
      const relY = y - boxY;
      if (relY < 0 || relY > H) return -1;
      const stride = lineH + gap;
      const idx = Math.floor(relY / stride);
      return (idx >= 0 && idx < choices.length) ? idx : -1;
    }

    const onMove = (e) => { try {
      const idx = indexFromPointer(e.clientX, e.clientY);
      if (idx !== -1 && idx !== active) { active = idx; elapsed = 0; }
    } catch {} };
    const onDown = (e) => { try {
      const idx = indexFromPointer(e.clientX, e.clientY);
      if (idx !== -1) { active = idx; elapsed = 0; }
    } catch {} };

    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerdown', onDown, { passive: true });

    const ring = (ctx, cx, cy, r, pct) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + pct * Math.PI*2);
      ctx.stroke();
    };

    const draw = (ctx, dt, staticFrame) => {
      const g = geom();
      const { W, H, cx, cy, R, boxX, boxY, boxW, lineH, gap } = g;

      ctx.clearRect(0, 0, W, H);

      if (!staticFrame && !prefersReduced) {
        elapsed += dt;
        if (elapsed > STEP_MS) { elapsed = 0; active = (active + 1) % choices.length; }
      }

      // Left: ring
      ctx.save();
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ring(ctx, cx, cy, R, 1);
      const pct = Math.min(1, elapsed / STEP_MS);
      ctx.strokeStyle = withAlpha(accent, 0.9);
      ring(ctx, cx, cy, R, pct);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Q${active+1}/${choices.length}`, cx, cy);
      ctx.restore();

      // Right: choices
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '12px Inter, system-ui, sans-serif';

      for (let i = 0; i < choices.length; i++) {
        const y = boxY + i * (lineH + gap);
        const isActive = i === active;

        let slide = 0;
        if (isActive) {
          const t = Math.min(1, elapsed / SLIDE_MS);
          slide = (1 - t) * 16;
        }

        const w = boxW, h = lineH;
        ctx.save(); ctx.translate(boxX, y);
        roundRectPath(ctx, slide, 0, w, h, 14);
        ctx.fillStyle = isActive ? withAlpha(accent, 0.22) : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.fillStyle = '#e5e7eb'; ctx.fillText(choices[i], slide + 14, h/2);

        if (i === correctIndex) {
          const nearEnd = elapsed > STEP_MS - PULSE_MS;
          if (isActive && nearEnd) {
            const p = Math.max(0, Math.min(1, (elapsed - (STEP_MS - PULSE_MS)) / PULSE_MS));
            const r = 8 + p * 10;
            ctx.beginPath(); ctx.arc(slide + w - 18, h/2, r, 0, Math.PI*2);
            ctx.fillStyle = withAlpha(accent, 0.25 * (1 - p)); ctx.fill();
            ctx.strokeStyle = withAlpha('#ffffff', 0.9); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(slide + w - 24, h/2);
            ctx.lineTo(slide + w - 20, h/2 + 6);
            ctx.lineTo(slide + w - 14, h/2 - 4);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    };

    return new Animator(canvas, draw);
  }

  /* -------------------- Init canvases -------------------- */
  function initCanvases() {
    document.querySelectorAll('[data-preview]').forEach((canvas) => {
      const type = canvas.dataset.preview;
      try {
        if      (type === 'breakout') breakoutPreview(canvas);
        else if (type === 'podcast')  podcastPreview(canvas);
        else if (type === 'faq')      faqPreview(canvas);
        else if (type === 'chatbot')  chatbotPreview(canvas);
        else if (type === 'quiz')     quizPreview(canvas);
      } catch (err) {
        console.error('Failed to init preview:', type, err);
      }
    });
  }

  /* -------------------- Fade-ins (with fallback) -------------------- */
  function initFadeIns() {
    const els = Array.from(document.querySelectorAll('.fade-in'));
    if (!els.length) return;

    try {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.1 });

      els.forEach(el => io.observe(el));

      // Safety: if nothing became visible after 1200ms, force them visible.
      setTimeout(() => {
        if (!document.querySelector('.fade-in.visible')) {
          els.forEach(el => el.classList.add('visible'));
        }
      }, 1200);
    } catch {
      // Older browsers: just show them
      els.forEach(el => el.classList.add('visible'));
    }
  }

  /* -------------------- Modal -------------------- */
  function initModal() {
    try {
      const openBtn = document.getElementById('open-podcast');
      const closeBtn = document.getElementById('close-podcast');
      const modal = document.getElementById('podcast-modal');
      const audio = document.getElementById('podcast-audio');
      if (!openBtn || !closeBtn || !modal) return;

      const open = () => modal.classList.remove('hidden');
      const close = () => { modal.classList.add('hidden'); audio && audio.pause(); };

      openBtn.addEventListener('click', open, { passive: true });
      closeBtn.addEventListener('click', close, { passive: true });
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { passive: true });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    } catch (err) { console.error('Modal init error:', err); }
  }

  /* -------------------- DOM Ready -------------------- */
  function ready(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(() => {
    try { initCanvases(); } catch (e) { console.error(e); }
    try { initFadeIns();  } catch (e) { console.error(e); }
    try { initModal();    } catch (e) { console.error(e); }
  });
})();
