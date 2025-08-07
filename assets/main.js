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
      // Guard against 0 size on initial layout
      if (!clientWidth || !clientHeight) return;
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // use CSS pixels in draw calls
    };

    resize();
    return { ctx, resize };
  }

  /** Rounded rect helper for Safari (older) */
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
        // draw at least one frame on resize to avoid blank
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
      if (this.running || prefersReduced) { 
        // If reduced motion, paint a single static frame
        if (!this.running) this.drawFrame(this.ctx, 0, true);
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

  /** Color helpers */
  function withAlpha(hex, a) {
    // expects #rrggbb
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /* ==================== Animations ==================== */

  // 1) Breakout mini-preview (neon phone frame, bouncing ball + paddle auto-aim)
  function breakoutPreview(canvas) {
    const accent = canvas.dataset.accent || '#22d3ee';
    const state = {
      w: () => canvas.clientWidth,
      h: () => canvas.clientHeight,
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

      // update physics
      const seconds = staticFrame ? 0 : Math.min(dt, 32) / 1000;
      state.ball.x += state.ball.vx * seconds;
      state.ball.y += state.ball.vy * seconds;

      // walls
      if (state.ball.x - state.ball.r < 0) { state.ball.x = state.ball.r; state.ball.vx *= -1; }
      if (state.ball.x + state.ball.r > sw) { state.ball.x = sw - state.ball.r; state.ball.vx *= -1; }
      if (state.ball.y - state.ball.r < 0) { state.ball.y = state.ball.r; state.ball.vy *= -1; }
      // paddle follows ball (auto-aim)
      const target = Math.max(0, Math.min(sw - state.paddle.w, state.ball.x - state.paddle.w/2));
      state.paddle.x += (target - state.paddle.x) * 8 * seconds;

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

  // 2) Podcast bars (already worked, now polished)
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

  // 3) FAQ typewriter lines
  function faqPreview(canvas) {
    const accent = canvas.dataset.accent || '#fde047';
    const lines = [
      'What is the project?',
      'How was it built?',
      'Can I use this code?',
      'Is it mobile-friendly?',
      'Where can I learn more?'
    ];
    let visible = 0, timer = 0;

    const draw = (ctx, dt, staticFrame) => {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      // document sheet
      const dw = Math.min(W * 0.7, 360), dh = Math.min(H * 0.7, 220);
      const dx = (W - dw) / 2, dy = (H - dh) / 2;
      roundRectPath(ctx, dx, dy, dw, dh, 10);
      ctx.strokeStyle = withAlpha(accent, 0.9);
      ctx.lineWidth = 2;
      ctx.stroke();

      // update typewriter
      if (!static
