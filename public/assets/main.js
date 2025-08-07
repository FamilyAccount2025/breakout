// FAQ — flip on click/tap; slow auto-flip hint (fixed non-mirrored text)
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
  const AUTO_DELAY = 3500; // subtle hint

  // Click/tap to flip a tile
  canvas.addEventListener('pointerdown', (e)=>{
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = layout.findIndex(b => x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h);
    if (hit>=0 && !tiles[hit].flipping) tiles[hit].flipping = true;
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

    // auto flip one tile periodically as a hint
    const now = performance.now();
    if (!staticFrame && now - lastAuto > AUTO_DELAY) {
      if (!tiles[autoIndex].flipping) tiles[autoIndex].flipping = true;
      autoIndex = (autoIndex+1) % tiles.length;
      lastAuto = now;
    }

    // update flip animation
    const dur = 800; // ms per flip
    const step = staticFrame ? 0 : dt;
    tiles.forEach(t => {
      if (t.flipping) {
        t.prog += step;
        if (t.prog >= dur) {
          t.side = (t.side === 'front') ? 'back' : 'front';
          t.prog = 0;
          t.flipping = false;
        }
      }
    });

    // draw tiles
    ctx.textBaseline='middle'; 
    ctx.textAlign='center';
    ctx.font = `${Math.max(10, Math.min(14, tileW/10))}px Inter, system-ui, sans-serif`;

    tiles.forEach((t, i) => {
      const {x,y,w,h} = layout[i];

      // progress 0..1 across the flip
      const p = t.flipping ? Math.min(1, (t.prog/dur)) : 0;

      // flip scale (1 -> 0 -> -1). Clamp tiny values to avoid math weirdness.
      let scaleX = 1 - Math.abs(2*p - 1)*2;
      if (Math.abs(scaleX) < 0.02) scaleX = (scaleX < 0 ? -0.02 : 0.02);

      // Which face is toward the viewer right now?
      const facingFront = scaleX > 0;
      const showQuestion = facingFront ? (t.side === 'front') : (t.side === 'back');
      const text = showQuestion ? t.q : t.a;

      // --- Draw the card "flip" (mirrored shape) ---
      ctx.save();
      ctx.translate(x + w/2, y + h/2);

      // Draw the card border with mirrored scale (visual flip)
      ctx.save();
      ctx.scale(scaleX, 1);
      roundRectPath(ctx, -w/2, -h/2, w, h, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; 
      ctx.fill();
      ctx.strokeStyle = withAlpha(accent, 0.55); 
      ctx.lineWidth = 1.5; 
      ctx.stroke();
      ctx.restore();

      // --- Clip to card, then draw readable text (non-mirrored) ---
      // Clip in unscaled space
      roundRectPath(ctx, -w/2, -h/2, w, h, 10);
      ctx.clip();

      // Scale by the absolute value so text compresses at mid-flip,
      // but never mirrors.
      ctx.scale(Math.abs(scaleX), 1);

      // Subtle accent wash on the "back" face
      if (!showQuestion) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        roundRectPath(ctx, -w/2, -h/2, w, h, 10);
        ctx.fillStyle = accent; 
        ctx.fill();
        ctx.restore();
      }

      // Text (centered)
      ctx.fillStyle = '#e5e7eb';
      ctx.fillText(text, 0, 0, w - 18);

      ctx.restore();
    });
  };

  return new Animator(canvas, draw);
}
