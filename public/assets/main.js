/* main.js — stable canvas previews + modal logic (v2)
 * - Crisp DPR scaling
 * - ResizeObserver + IntersectionObserver
 * - Prefers-reduced-motion support
 * - FIXES: Chatbot timing/logic; FAQ: slower + click/tap flips with gentle auto-hint
 */

(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animators = [];

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

      this.ro = new ResizeObserver(() => {
        this.resizeFn();
        if (!this.running) this.drawFrame(this.ctx, 0, true);
      });
      this.ro.observe(canvas);

      this.io = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) this.start();
        else this.stop();
      }, { threshold: 0.1 });
      this.io.observe(canvas);
    }
    start() {
      if (this.running) return;
      if (prefersReduced) {
        this.drawFrame(this.ctx, 0, true);
        return;
      }
      this.running = true;
      const loop = (ts) => {
        if (!this.running) return;
        const dt = this.lastTs ? (ts - this.lastTs) : 16;
        this.lastTs = ts;
        this.drawFrame(this.ctx, dt, false);
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
      this.ro.disconnect();
      this.io.disconnect();
    }
  }

  /* ==================== PREVIEWS ==================== */

  // BREAKOUT (unchanged from stable build)
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

      const seconds = staticFrame ? 0 : Math.min(dt, 32)/1000;
      state.ball.x += state.ball.vx * seconds;
      state.ball.y += state.ball.vy * seconds;

      // walls
      if (state.ball.x - state.ball.r < 0) { state.ball.x = state.ball.r; state.ball.vx *= -1; }
      if (state.ball.x + state.ball.r > sw) { state.ball.x = sw - state.ball.r; state.ball.vx *= -1; }
      if (state.ball.y - state.ball.r < 0) { state.ball.y = state.ball.r; state.ball.vy *= -1; }

      // paddle follows ball
      const target = Math.max(0, Math.min(sw - paddle.w, state.ball.x - paddle.w/2));
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

      ctx.fillStyle = withAlpha('#fff',0.9);
      roundRectPath(ctx, sx+paddle.x, sy+pyP, paddle.w, paddle.h, 3); ctx.fill();
      ctx.beginPath(); ctx.arc(sx+state.ball.x, sy+state.ball.y, state.ball.r, 0, Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
    };
    return new Animator(canvas, draw);
  }

  // PODCAST (unchanged)
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

  // FAQ — flip on click/tap; slow auto-flip hint
  function faqPreview(canvas) {
    const accent = canvas.dataset.accent || '#fde047';

    const tiles = [
      { q:'What is it?', a:'AI-driven FAQ system.' },
      { q:'How built?', a:'LLM + context index.' },
      { q:'Editable?', a:'Yes, CMS-friendly.' },
      { q:'Responsive?', a:'Mobile-first layout.' },
      { q:'Searchable?', a:'Semantic search.' },
      { q:'Branding?', a:'Themeable UI.' },
    ].map(t => ({ ...t, side: 'front', flipping:false, prog:0 }));

    const cols=3, rows=2, gap=10;
    let layout = []; // computed bounds
    let lastAuto = 0, autoIndex = 0;
    const AUTO_DELAY = 3500; // slower hint

    // pointer → flip on click/tap
    canvas.addEventListener('pointerdown', (e)=>{
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = layout.findIndex(b => x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h);
      if (hit>=0 && !tiles[hit].flipping) {
        tiles[hit].flipping = true;
      }
    }, {passive:true});

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      // compute grid
      const tileW = (W - gap*(cols+1))/cols;
      const tileH = (H - gap*(rows+1))/rows;
      layout = [];
      for (let r=0;r<rows;r++){
        for (let c=0;c<cols;c++){
          const i = r*cols + c;
          layout[i] = { x: gap + c*(tileW+gap), y: gap + r*(tileH+gap), w: tileW, h: tileH };
        }
      }

      // auto hint flip
      const now = performance.now();
      if (!staticFrame && now - lastAuto > AUTO_DELAY) {
        if (!tiles[autoIndex].flipping) tiles[autoIndex].flipping = true;
        autoIndex = (autoIndex+1) % tiles.length;
        lastAuto = now;
      }

      // animation update
      const dur = 800; // ms per half-flip (slower)
      const step = staticFrame ? 0 : dt;
      tiles.forEach(t => {
        if (t.flipping && !prefersReduced) {
          t.prog += step;
          if (t.prog >= dur) {
            // switch side at halfway (simulate two halves)
            t.side = t.side === 'front' ? 'back' : 'front';
            t.prog = 0;
            t.flipping = false;
          }
        } else if (prefersReduced) {
          t.flipping = false; t.prog = 0;
        }
      });

      // draw tiles
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.font = `${Math.max(10, Math.min(14, tileW/10))}px Inter, system-ui, sans-serif`;

      tiles.forEach((t, i) => {
        const {x,y,w,h} = layout[i];

        // progress 0..1 across the full flip (front->back or back->front)
        const p = t.flipping ? Math.min(1, (t.prog/dur)) : 0;
        // scaleX: 1 -> 0 -> -1 (front to back)
        let scaleX = 1 - Math.abs(2*p - 1)*2;
        if (Math.abs(scaleX) < 0.02) scaleX = scaleX < 0 ? -0.02 : 0.02;

        ctx.save();
        ctx.translate(x + w/2, y + h/2);
        ctx.scale(scaleX, 1);

        // card
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.fillStyle = withAlpha('#fff', 0.06); ctx.fill();
        ctx.strokeStyle = withAlpha(accent, 0.55); ctx.lineWidth = 1.5; ctx.stroke();

        const front = scaleX > 0 ? (t.side==='front') : (t.side==='back'); // which text to show during flip
        const text = front ? t.q : t.a;

        if (!front) { // accent wash on back
          ctx.save();
          ctx.globalAlpha = 0.12;
          roundRectPath(ctx, -w/2, -h/2, w, h, 10);
          ctx.fillStyle = accent; ctx.fill();
          ctx.restore();
        }

        ctx.fillStyle = '#e5e7eb';
        ctx.fillText(text, 0, 0, w-18);
        ctx.restore();
      });
    };

    return new Animator(canvas, draw);
  }

  // CHATBOT — fixed logic: bot has a typing phase, user just slides in
  function chatbotPreview(canvas) {
    const accent = canvas.dataset.accent || '#34d399';
    const script = [
      { role:'user', text:'How was Breakout built?' },
      { role:'bot',  text:'With AI-assisted code and canvas.' },
      { role:'user', text:'Is it mobile-friendly?' },
      { role:'bot',  text:'Yes — responsive & fast.' },
    ];

    let phase = 0;   // 0..(script.length*2 - 1)
    let timer = 0;

    const TYPE_TIME = 1100;  // bot typing duration
    const SHOW_TIME = 1700;  // visible time for each message
    const SLIDE_IN  = 300;   // slide-in duration

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0,0,W,H);

      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      // Determine current message + whether it’s a bot typing phase
      const msgIndex = Math.floor(phase / 2);
      const current = script[msgIndex];
      const botTypingPhase = (current.role === 'bot') && (phase % 2 === 0);

      // advance timer
      if (!staticFrame) {
        const dur = botTypingPhase ? TYPE_TIME : SHOW_TIME;
        timer += dt;
        if (timer > dur) {
          timer = 0;
          phase = (phase + 1) % (script.length * 2);
        }
      }

      // show last up to 4 messages (for context)
      const start = Math.max(0, msgIndex - 3);
      const visible = script.slice(start, msgIndex + 1);
      let y = 10;

      visible.forEach((msg, i) => {
        const isLatest = (start + i) === msgIndex;
        const isBot = msg.role === 'bot';

        // text width (set font before measuring)
        const text = (isLatest && botTypingPhase) ? '' : msg.text;
        const textWidth = ctx.measureText(text).width;
        const bubbleW = Math.min(W - 24, Math.max(140, textWidth + 28));
        const x = isBot ? (W - bubbleW - 12) : 12;

        // slide-in offset for newest message
        let slide = 0;
        if (isLatest) {
          const t = Math.min(1, timer / (botTypingPhase ? TYPE_TIME : SLIDE_IN));
          slide = (isBot ? 1 : -1) * (1 - t) * 14;
        }

        // bubble
        roundRectPath(ctx, x + slide, y, bubbleW, 26, 10);
        ctx.fillStyle = isBot ? withAlpha(accent, 0.22) : withAlpha('#ffffff', 0.10);
        ctx.fill();

        // content
        ctx.fillStyle = '#e5e7eb';

        if (isLatest && botTypingPhase && !staticFrame) {
          // typing dots
          const cx = x + slide + bubbleW/2 - 14;
          const cy = y + 13;
          for (let d=0; d<3; d++) {
            const r = 3 + (Math.sin(Date.now()/250 + d) * 1.5 + 1.5) / 2;
            ctx.beginPath();
            ctx.arc(cx + d*14, cy, r, 0, Math.PI*2);
            ctx.fill();
          }
        } else {
          ctx.fillText(text, x + slide + 12, y + 13);
        }

        y += 26 + 8;
      });
    };

    return new Animator(canvas, draw);
  }

  /* ---------- Init canvases ---------- */
  function initCanvases() {
    document.querySelectorAll('[data-preview]').forEach((canvas) => {
      const type = canvas.dataset.preview;
      let a = null;
      if (type === 'breakout') a = breakoutPreview(canvas);
      else if (type === 'podcast') a = podcastPreview(canvas);
      else if (type === 'faq') a = faqPreview(canvas);
      else if (type === 'chatbot') a = chatbotPreview(canvas);
      if (a) animators.push(a);
    });
  }

  /* ---------- Fade-in cards ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => io.observe(el));

  /* ---------- Modal ---------- */
  function initModal() {
    const openBtn = document.getElementById('open-podcast');
    const closeBtn = document.getElementById('close-podcast');
    const modal = document.getElementById('podcast-modal');
    const audio = document.getElementById('podcast-audio');
    if (!openBtn || !closeBtn || !modal) return;

    const open = () => modal.classList.remove('hidden');
    const close = () => { modal.classList.add('hidden'); audio?.pause(); };

    openBtn.addEventListener('click', open, { passive: true });
    closeBtn.addEventListener('click', close, { passive: true });
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { passive: true });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initCanvases(); initModal(); });
  } else {
    initCanvases(); initModal();
  }
})();
