/* main.js — stable canvas previews + modal logic
 * - Crisp drawing with devicePixelRatio scaling
 * - ResizeObserver to handle container size changes
 * - IntersectionObserver to pause off-screen animations
 * - Respects prefers-reduced-motion
 */

(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Setup crisp 2D context scaled by DPR */
  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (!clientWidth || !clientHeight) return;
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    };

    resize();
    return { ctx, resize };
  }

  /** Rounded rect helper (Safari-friendly) */
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** Color helpers */
  function withAlpha(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /** Base animator with start/stop and observers */
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

      // ResizeObserver for crisp scaling
      this.ro = new ResizeObserver(() => {
        this.resizeFn();
        // paint at least one frame to avoid blank after resize
        if (!this.running) this.drawFrame(this.ctx, 0, true);
      });
      this.ro.observe(canvas);

      // IntersectionObserver to pause when offscreen
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

  /* ==================== Animations ==================== */

  // 1) Breakout mini-preview (neon phone frame, bouncing ball + paddle)
  function breakoutPreview(canvas) {
    const accent = canvas.dataset.accent || '#22d3ee';
    const state = {
      screen: { x: 0, y: 0, w: 0, h: 0 },
      ball: { x: 80, y: 60, vx: 120, vy: 140, r: 6 },
      paddle: { w: 56, h: 7, x: 60 },
    };

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      // Phone frame
      const phoneW = Math.min(W * 0.7, H * 0.55);
      const phoneH = phoneW * 1.8;
      const px = (W - phoneW) / 2;
      const py = (H - phoneH) / 2;
      roundRectPath(ctx, px, py, phoneW, phoneH, 14);
      ctx.strokeStyle = withAlpha(accent, 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Screen area
      const sPad = 10;
      const sx = px + sPad;
      const sy = py + sPad * 2;
      const sw = phoneW - sPad * 2;
      const sh = phoneH - sPad * 3;
      state.screen = { x: sx, y: sy, w: sw, h: sh };

      // clip to screen
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.clip();

      // bricks shimmer
      const rows = 3, cols = 6;
      const bw = sw / cols, bh = 10, gap = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bx = sx + c * bw + gap/2;
          const by = sy + 10 + r * (bh + gap);
          roundRectPath(ctx, bx, by, bw - gap, bh, 3);
          const pulse = 0.6 + 0.4 * Math.sin((Date.now()/400) + (r*cols+c));
          ctx.fillStyle = withAlpha(accent, 0.25 * pulse);
          ctx.fill();
        }
      }

      // physics
      const seconds = staticFrame ? 0 : Math.min(dt, 32) / 1000;
      state.ball.x += state.ball.vx * seconds;
      state.ball.y += state.ball.vy * seconds;

      // walls
      if (state.ball.x - state.ball.r < 0) { state.ball.x = state.ball.r; state.ball.vx *= -1; }
      if (state.ball.x + state.ball.r > sw) { state.ball.x = sw - state.ball.r; state.ball.vx *= -1; }
      if (state.ball.y - state.ball.r < 0) { state.ball.y = state.ball.r; state.ball.vy *= -1; }

      // paddle follows ball (auto-aim)
      const target = Math.max(0, Math.min(sw - state.paddle.w, state.ball.x - state.paddle.w/2));
      state.paddle.x += (target - state.paddle.x) * (staticFrame ? 1 : 8) * seconds;

      // paddle collision
      const pyP = sh - 16;
      if (state.ball.y + state.ball.r > pyP &&
          state.ball.x > state.paddle.x &&
          state.ball.x < state.paddle.x + state.paddle.w &&
          state.ball.vy > 0) {
        state.ball.y = pyP - state.ball.r;
        state.ball.vy *= -1;
      }
      // floor bounce (loop)
      if (state.ball.y - state.ball.r > sh) {
        state.ball.x = Math.random() * (sw * 0.6) + sw*0.2;
        state.ball.y = sh * 0.4;
        state.ball.vx = (Math.random() > 0.5 ? 1 : -1) * (100 + Math.random()*80);
        state.ball.vy = 120 + Math.random() * 120;
      }

      // draw paddle/ball
      ctx.fillStyle = withAlpha('#ffffff', 0.9);
      roundRectPath(ctx, sx + state.paddle.x, sy + pyP, state.paddle.w, state.paddle.h, 3);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sx + state.ball.x, sy + state.ball.y, state.ball.r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      ctx.restore();
    };
    return new Animator(canvas, draw);
  }

  // 2) Podcast bars
  function podcastPreview(canvas) {
    const accent = canvas.dataset.accent || '#f472b6';
    const bars = 7;
    const phases = new Array(bars).fill(0).map((_, i) => i * 0.7);
    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      const totalW = W * 0.6;
      const barW = totalW / bars * 0.6;
      const gap = (totalW / bars) - barW;
      const startX = (W - totalW) / 2;
      const base = H * 0.65;

      phases.forEach((ph, i) => {
        const t = (Date.now() / 500) + ph;
        const amp = staticFrame ? 0.4 : (0.35 + 0.35 * Math.sin(t));
        const h = Math.max(8, H * 0.4 * amp);
        const x = startX + i * (barW + gap);
        ctx.fillStyle = withAlpha(accent, 0.85);
        roundRectPath(ctx, x, base - h, barW, h, 4);
        ctx.fill();
      });
    };
    return new Animator(canvas, draw);
  }

  // 3) FAQ flip-cards preview (grid of flipping tiles: front=title, back=answer)
  function faqPreview(canvas) {
    const accent = canvas.dataset.accent || '#fde047';
    const tiles = [
      { q: 'What is it?', a: 'An AI-driven FAQ system.' },
      { q: 'How built?', a: 'LLM + context indexing.' },
      { q: 'Can I edit?', a: 'Yes, content is CMS-ready.' },
      { q: 'Responsive?', a: 'Fully mobile-friendly.' },
      { q: 'Searchable?', a: 'Supports semantic search.' },
      { q: 'Branding?', a: 'Themeable to your brand.' },
    ];

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      // Grid layout (3 cols x 2 rows)
      const cols = 3, rows = 2, gap = 10;
      const tileW = (W - gap * (cols + 1)) / cols;
      const tileH = (H - gap * (rows + 1)) / rows;

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      const now = Date.now();
      const period = 1400; // ms per tile flip
      const totalCycle = period * tiles.length;

      for (let i = 0; i < tiles.length; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = gap + c * (tileW + gap);
        const y = gap + r * (tileH + gap);

        // Each tile flips in sequence
        const t = ((now + i * period) % totalCycle) / period; // 0..tiles.length, phased
        // Flip progress 0..1 for current tile
        let progress = (now % period) / period;
        // make each tile flip with its own offset
        progress = ((now + i * 180) % period) / period;

        // Smooth step for nicer easing
        const ease = (p) => p*p*(3-2*p);
        const p = staticFrame ? 0 : ease(progress);

        // Compute scaleX for flip (1 -> 0 -> -1)
        let scaleX = 1 - Math.abs(2 * p - 1) * 2; // 1 to -1
        // Clamp a bit to avoid numerical weirdness near 0
        if (Math.abs(scaleX) < 0.02) scaleX = scaleX < 0 ? -0.02 : 0.02;

        // Draw card background (shadow)
        ctx.save();
        ctx.translate(x + tileW / 2, y + tileH / 2);
        ctx.scale(scaleX, 1);

        roundRectPath(ctx, -tileW/2, -tileH/2, tileW, tileH, 10);
        ctx.fillStyle = withAlpha('#ffffff', 0.06);
        ctx.fill();
        ctx.strokeStyle = withAlpha(accent, 0.55);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Front/back content based on sign of scaleX
        const front = scaleX > 0; // front = question, back = answer
        ctx.fillStyle = front ? '#e5e7eb' : '#111827';
        ctx.font = `${Math.max(10, Math.min(14, tileW / 10))}px Inter, system-ui, sans-serif`;
        const text = front ? tiles[i].q : tiles[i].a;

        // Accent strip on back side
        if (!front) {
          ctx.save();
          ctx.globalAlpha = 0.15;
          roundRectPath(ctx, -tileW/2, -tileH/2, tileW, tileH, 10);
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.restore();
        }

        // Text
        ctx.fillText(text, 0, 0, tileW - 18);

        ctx.restore();
      }
    };

    return new Animator(canvas, draw);
  }

  // 4) Chatbot conversation preview (clear typing, alternating bubbles, looping)
  function chatbotPreview(canvas) {
    const accent = canvas.dataset.accent || '#34d399';

    const script = [
      { role: 'user', text: 'How was Breakout built?' },
      { role: 'bot',  text: 'With AI-assisted code and canvas.' },
      { role: 'user', text: 'Is it mobile-friendly?' },
      { role: 'bot',  text: 'Yes — responsive & fast.' },
    ];

    let phase = 0; // which script index is “active” (typing or showing)
    let timer = 0;

    // timings (ms)
    const SHOW_TIME = 1700;   // how long a finished message stays
    const TYPE_TIME = 1100;   // typing duration

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      const margin = 12;
      const maxBubbleW = W - margin * 4;
      const lineH = 26;

      // Advance timer
      if (!staticFrame) {
        timer += dt;
        if (timer > (isBotTyping() ? TYPE_TIME : SHOW_TIME)) {
          timer = 0;
          phase = (phase + 1) % (script.length * 2); // each message has typing+show phases
        }
      }

      // Draw recent 3 messages for visual clarity
      const visibleMsgs = [];
      const msgIndex = Math.floor(phase / 2); // current message index
      for (let i = Math.max(0, msgIndex - 2); i <= msgIndex; i++) {
        visibleMsgs.push(i);
      }

      let y = margin;
      visibleMsgs.forEach((i) => {
        const msg = script[i];
        const isBot = msg.role === 'bot';
        const bubbleW = Math.min(maxBubbleW, Math.max(140, ctx.measureText(msg.text).width + 28));
        const x = isBot ? (W - bubbleW - margin) : margin;

        // slide-in animation for the newest message
        let slideOffset = 0;
        if (i === msgIndex) {
          const p = Math.min(1, timer / (isBotTyping() ? TYPE_TIME : 300));
          slideOffset = (isBot ? 1 : -1) * (1 - p) * 12; // slide from side
        }

        // bubble
        ctx.save();
        roundRectPath(ctx, x + slideOffset, y, bubbleW, lineH, 10);
        ctx.fillStyle = isBot ? withAlpha(accent, 0.22) : withAlpha('#ffffff', 0.10);
        ctx.fill();

        // content: typing dots or text
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        if (i === msgIndex && isBotTyping()) {
          // typing indicator
          const dots = 3;
          const cx = x + slideOffset + bubbleW / 2 - 14;
          const cy = y + lineH / 2;
          for (let d = 0; d < dots; d++) {
            const r = 3 + (Math.sin(Date.now() / 250 + d) * 1.5 + 1.5) / 2;
            ctx.beginPath();
            ctx.arc(cx + d * 14, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // text
          const tx = x + slideOffset + 12;
          const ty = y + lineH / 2;
          ctx.fillText(msg.text, tx, ty);
        }
        ctx.restore();

        y += lineH + 8;
      });

      // helper
      function isBotTyping() {
        // typing happens only on bot phases (odd phases)
        const onBotPhase = (phase % 2 === 0) ? (script[msgIndex].role !== 'bot') : (script[msgIndex].role === 'bot');
        // Equivalent simpler: bot message has a typing phase (odd index in 2x sequence)
        const typing = (phase % 2 === 0) ? false : (script[msgIndex].role === 'bot');
        return typing && !staticFrame;
      }
    };

    return new Animator(canvas, draw);
  }

  /* ============== Boot ============== */
  function initCanvases() {
    document.querySelectorAll('[data-preview]').forEach((canvas) => {
      const type = canvas.dataset.preview;
      switch (type) {
        case 'breakout': breakoutPreview(canvas); break;
        case 'podcast':  podcastPreview(canvas);  break;
        case 'faq':      faqPreview(canvas);      break;
        case 'chatbot':  chatbotPreview(canvas);  break;
        default: break;
      }
    });
  }

  // Fade-in intersection for cards
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => io.observe(el));

  // Modal logic
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

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initCanvases(); initModal(); });
  } else {
    initCanvases(); initModal();
  }
})();
