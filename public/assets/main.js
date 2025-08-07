// 5) QUIZ — progress ring + cycling choices + hover/tap highlight (+ subtle correct pulse)
function quizPreview(canvas) {
  const accent = canvas.dataset.accent || '#a78bfa';

  const choices = ['Premiums', 'Deductible', 'Copay', 'Out-of-Pocket'];
  let active = 0;
  let elapsed = 0;

  // timings
  const STEP_MS = 1800; // auto-cycle duration
  const SLIDE_MS = 220; // slide-in for active pill
  const PULSE_MS = 500; // check pulse near end
  const correctIndex = 1; // "Deductible"

  // layout constants (computed on the fly from canvas size)
  const geom = () => {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    return {
      W, H,
      cx: W * 0.22,
      cy: H * 0.5,
      R:  Math.min(W, H) * 0.18,
      boxX: W * 0.44,
      boxY: H * 0.22,
      boxW: W * 0.48,
      lineH: 28,
      gap: 10,
    };
  };

  // Pointer → which index is under the cursor?
  function indexFromPointer(clientX, clientY) {
    const { left, top } = canvas.getBoundingClientRect();
    const x = clientX - left;
    const y = clientY - top;
    const { boxX, boxY, boxW, lineH, gap, H } = geom();

    // within horizontal range?
    if (x < boxX || x > boxX + boxW) return -1;
    // compute row
    const relY = y - boxY;
    if (relY < 0 || relY > H) return -1;
    const stride = lineH + gap;
    const idx = Math.floor(relY / stride);
    return (idx >= 0 && idx < choices.length) ? idx : -1;
  }

  // listeners (hover highlights, tap/click selects & restarts cycle)
  const onMove = (e) => {
    const idx = indexFromPointer(e.clientX, e.clientY);
    if (idx !== -1 && idx !== active) {
      active = idx;
      elapsed = 0; // restart progress so ring reflects your focus
    }
  };
  const onDown = (e) => {
    const idx = indexFromPointer(e.clientX, e.clientY);
    if (idx !== -1) {
      active = idx;
      elapsed = 0; // “confirm” the choice by restarting the step
    }
  };
  // Passive for smooth scrolling on mobile
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', onDown, { passive: true });

  // drawing helpers
  const ring = (ctx, cx, cy, r, pct) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + pct * Math.PI*2);
    ctx.stroke();
  };

  const draw = (ctx, dt, staticFrame) => {
    const g = geom();
    const { W, H, cx, cy, R, boxX, boxY, boxW, lineH, gap } = g;

    ctx.clearRect(0, 0, W, H);

    // auto-cycle if user isn't actively hovering a different option
    if (!staticFrame) {
      elapsed += dt;
      if (elapsed > STEP_MS) {
        elapsed = 0;
        active = (active + 1) % choices.length;
      }
    }

    // Left: progress ring
    ctx.save();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ring(ctx, cx, cy, R, 1);

    const pct = Math.min(1, elapsed / STEP_MS);
    ctx.strokeStyle = withAlpha(accent, 0.9);
    ring(ctx, cx, cy, R, pct);

    ctx.fillStyle = '#e5e7eb';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Q${active+1}/${choices.length}`, cx, cy);
    ctx.restore();

    // Right: choices list
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '12px Inter, system-ui, sans-serif';

    for (let i = 0; i < choices.length; i++) {
      const y = boxY + i * (lineH + gap);
      const isActive = i === active;

      // slide-in for active
      let slide = 0;
      if (isActive) {
        const t = Math.min(1, elapsed / SLIDE_MS);
        slide = (1 - t) * 16;
      }

      const w = boxW, h = lineH;
      ctx.save();
      ctx.translate(boxX, y);

      roundRectPath(ctx, slide, 0, w, h, 14);
      ctx.fillStyle = isActive ? withAlpha(accent, 0.22) : 'rgba(255,255,255,0.08)';
      ctx.fill();

      ctx.fillStyle = '#e5e7eb';
      ctx.fillText(choices[i], slide + 14, h / 2);

      // subtle check pulse near end for the “correct” item
      if (i === correctIndex) {
        const nearEnd = elapsed > STEP_MS - PULSE_MS;
        if (isActive && nearEnd) {
          const p = (elapsed - (STEP_MS - PULSE_MS)) / PULSE_MS; // 0..1
          const r = 8 + Math.max(0, Math.min(1, p)) * 10;
          ctx.beginPath();
          ctx.arc(slide + w - 18, h / 2, r, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(accent, 0.25 * (1 - Math.max(0, Math.min(1, p))));
          ctx.fill();

          // check mark
          ctx.strokeStyle = withAlpha('#ffffff', 0.9);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(slide + w - 24, h / 2);
          ctx.lineTo(slide + w - 20, h / 2 + 6);
          ctx.lineTo(slide + w - 14, h / 2 - 4);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  };

  return new Animator(canvas, draw);
}
