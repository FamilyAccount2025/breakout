/* main.js — stable canvas previews + modal logic (v3)
 * - Device-pixel-ratio scaling
 * - ResizeObserver + IntersectionObserver
 * - Prefers-reduced-motion
 * - Robust FAQ flips (non-mirrored text, click/tap + slow auto-hint)
 * - Robust Chatbot typing -> message flow
 */

(() => {
  const prefersReduced = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  /* ---------- Canvas setup ---------- */
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

  /* ---------- Helpers ---------- */
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

  /* ---------- Animator ---------- */
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
      this.ro = new ResizeObserver(() => {
        this.resizeFn();
        if (!this.running) this.drawFrame(this.ctx, 0, true);
      });
      this.ro.observe(canvas);

      // pause when offscreen
      this.io = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) this.start();
        else this.stop();
      }, { threshold: 0.1 });
      this.io.observe(canvas);
    }
    start() {
      if (this.running) return;
      if (prefersReduced) { this.drawFrame(this.ctx, 0, true); return; }
      this.running = true;
      const loop = (ts) => {
        if (!this.running) return;
        const dt = this.lastTs ? (ts - this.lastTs) : 16;
        this.lastTs = ts;
        try {
          this.drawFrame(this.ctx, dt, false);
        } catch (err) {
          // Fail-safe: stop this animator so it can’t break the whole page
          console.error('Canvas animator error:', err);
          this.stop();
        }
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
      this.stop(); this.ro.disconnect(); this.io.disconnect();
    }
  }

  /* ==================== PREVIEWS ==================== */

  // 1) Breakout mini-preview
  function breakoutPreview(canvas) {
    const accent = canvas.dataset.accent || '#22d3ee';
    const state = {
      screen: { x: 0, y: 0, w: 0, h: 0 },
      ball: { x: 80, y: 60, vx: 120, vy: 140, r: 6 },
    };
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
      state.screen = { x: sx, y: sy, w: sw, h: sh };

      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();

      // bricks shimmer
      const rows=3, cols=6, bh=10, gap=4, bw=sw/cols;
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
        const bx=sx+c*bw+gap/2, by=sy+10+r*(bh+gap);
        roundRectPath(ctx,bx,by,bw-gap,bh,3);
        const pulse=0.6+0.4*Math.sin((Date.now()/400)+(r*cols+c));
        ctx.fillStyle=withAlpha(accent, 0.25*pulse); ctx.fill();
      }

      // motion
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

  // 3) FAQ — flip on click/tap; slow auto-flip hint; TEXT NEVER MIRRORS
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
    const AUTO_DELAY = 3500; // gentle hint
    const FLIP_MS = 900;     // slower flip

    // pointer flips
    canvas.addEventListener('pointerdown', (e)=>{
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = layout.findIndex(b => x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h);
      if (hit>=0 && !tiles[hit].flipping) tiles[hit].flipping = true;
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

        // progress 0..1; scaleX via cosine so it’s smooth 1→0→-1
        const p = tile.flipping ? clamp(tile.t / FLIP_MS, 0, 1) : 0;
        const scaleX = Math.cos(p * Math.PI); // 1 .. 0 .. -1
        const drawScale = Math.max(0.02, Math.abs(scaleX)); // never mirror text, just compress

        // which face to show during flip: first half current, second half opposite
        const showFront = p < 0.5 ? (tile.side === 'front') : (tile.side !== 'front');
        const text = showFront ? tile.q : tile.a;

        ctx.save();
        ctx.translate(x + w/2, y + h/2);

        // draw card border with actual flip (mirrored shape)
        ctx.save();
        ctx.scale(scaleX, 1);
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = withAlpha(accent, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();

        // clip unscaled shape
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.clip();

        // draw face content without mirroring text
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

  // 4) Chatbot — clear typing phase for bot, slide-in for all
  function chatbotPreview(canvas) {
    const accent = canvas.dataset.accent || '#34d399';

    const script = [
      { role:'user', text:'How was Breakout built?' },
      { role:'bot',  text:'With AI-assisted code and canvas.' },
      { role:'user', text:'Is it mobile-friendly?' },
      { role:'bot',  text:'Yes — responsive & fast.' },
    ];

    // Build a phase list: user=show, bot=typing then show
    const phases = [];
    script.forEach((m, idx) => {
      if (m.role === 'bot') phases.push({ idx, kind:'typing' });
      phases.push({ idx, kind:'show' });
    });

    let phaseIdx = 0;
    let elapsed = 0;

    const DUR = { typing: 1100, show: 1700, slide: 300 };

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      // advance timing
      if (!staticFrame && !prefersReduced) {
        elapsed += dt;
        const cur = phases[phaseIdx];
        const curDur = DUR[cur.kind];
        if (elapsed > curDur) {
          elapsed = 0;
          phaseIdx = (phaseIdx + 1) % phases.length;
        }
      }

      const curPhase = phases[phaseIdx];
      const curMsgIndex = curPhase.idx;

      // Render last up to 4 messages including current
      const start = Math.max(0, curMsgIndex - 3);
      let y = 10;
      for (let i = start; i <= curMsgIndex; i++) {
        const msg = script[i];
        const isBot = msg.role === 'bot';
        const isLatest = i === curMsgIndex;

        const showingTyping = isLatest && (curPhase.kind === 'typing') && isBot;
        const text = showingTyping ? '' : msg.text;

        // Measure after setting font
        const textWidth = ctx.measureText(text).width;
        const bubbleW = Math.min(W - 24, Math.max(140, textWidth + 28));
        const x = isBot ? (W - bubbleW - 12) : 12;

        // slide-in for newest message (typing or show)
        let slide = 0;
        if (isLatest) {
          const t = clamp(elapsed / DUR.slide, 0, 1);
          slide = (isBot ? 1 : -1) * (1 - t) * 14;
        }

        // bubble
        roundRectPath(ctx, x + slide, y, bubbleW, 26, 10);
        ctx.fillStyle = isBot ? withAlpha(accent, 0.22) : withAlpha('#ffffff', 0.10);
        ctx.fill();

        // content
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

  /* ---------- Init canvases ---------- */
  function initCanvases() {
    document.querySelectorAll('[data-preview]').forEach((canvas) => {
      const type = canvas.dataset.preview;
      try {
        if      (type === 'breakout') breakoutPreview(canvas);
        else if (type === 'podcast')  podcastPreview(canvas);
        else if (type === 'faq')      faqPreview(canvas);
        else if (type === 'chatbot')  chatbotPreview(canvas);
      } catch (err) {
        console.error('Failed to init preview:', type, err);
      }
    });
  }

  /* ---------- Fade-in cards ---------- */
  (function initFadeIns(){
    try {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.fade-in').forEach(el => io.observe(el));
    } catch {}
  })();

  /* ---------- Modal ---------- */
  function initModal() {
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
  }

  /* ---------- DOM Ready ---------- */
  function ready(fn){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(() => { initCanvases(); initModal(); });
})();
