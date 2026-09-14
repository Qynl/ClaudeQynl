/* NEX EYES RENDERER — canvas, 60fps, blends a state loop + one-shot overlays + micro-behaviour */
(function () {
  const { A, STATE_ANIM, IDLE_FIDGETS, MUSIC_VARIANTS } = window.NexAnims;
  const abs = Math.abs; const ease = (x) => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const canvas = document.getElementById('eyes');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  const THEMES = { cyan: 190, purple: 275, green: 140, orange: 28, pink: 330, white: 200 };
  let baseHue = THEMES.cyan;
  let baseSat = 95;

  const EYE = { w: 150, h: 200, gap: 110, radius: 26 };

  const state = {
    loopName: 'idle', loopStart: performance.now() / 1000,
    prevLoop: null, prevLoopStart: 0, crossfade: 0.55,   // loop → loop crossfade
    transition: null,                                     // {steps:[{name,start,dur}], target}
    propAlpha: {},                                        // per-prop fade 0..1
    shots: [],                       // {name, start}
    ctx: { beat: 0, energy: 0 },
    music: false, musicVariant: 'music_vibe', musicVariantAt: 0,
    mouse: { x: 0, y: 0, active: false, last: 0 },
    lastFidget: 0, nextFidget: 3 + Math.random() * 4,
    lastBlink: 0, nextBlink: 2 + Math.random() * 4,
    cur: {},   // smoothed pose
    hidden: false,
  };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || (canvas.ownerDocument.defaultView||window).innerWidth; H = canvas.clientHeight || (canvas.ownerDocument.defaultView||window).innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const s = Math.min(W / 560, H / 420, 1.6);
    EYE.w = 150 * s; EYE.h = 200 * s; EYE.gap = 110 * s; EYE.radius = 26 * s;
    state.scale = s;
  }
  window.addEventListener('resize', resize); resize();

  // ---------- public API ----------
  const api = {
    setState(st, anim) {
      const name = anim && A[anim] ? anim : (STATE_ANIM[st] || 'idle');
      const m = A[name].meta || {};
      if (m.kind === 'shot') { api.play(name); return; }
      state.userLoop = name;
      if (state.music && name === 'idle') { return; }  // stay vibing while music plays
      api.setLoop(name);
    },
    /** switch to a new loop, playing exit/enter clips when leaving/entering a family */
    setLoop(name) {
      if (!A[name]) return;
      const target = state.transition ? state.transition.target : state.loopName;
      if (name === target) return;
      const from = A[state.loopName].meta || {}, to = A[name].meta || {};
      const sameFamily = from.family && from.family === to.family;
      const steps = [];
      const t0 = now();
      let acc = 0;
      if (!sameFamily && from.exit && A[from.exit]) { const d = A[from.exit](0, state.ctx).duration || 1; steps.push({ name: from.exit, start: t0 + acc, dur: d }); acc += d - .15; }
      if (!sameFamily && to.enter && A[to.enter]) { const d = A[to.enter](0, state.ctx).duration || 1; steps.push({ name: to.enter, start: t0 + acc, dur: d }); acc += d - .15; }
      state.transition = { steps, target: name, switchAt: t0 + (steps.length ? Math.max(0, acc - (to.enter ? (A[to.enter](0, state.ctx).duration || 1) * .45 : 0)) : 0), started: false };
      if (!steps.length) beginLoop(name);
    },
    play(name) { if (!A[name]) return; state.shots = state.shots.filter(s => s.name !== name); state.shots.push({ name, start: now() }); },
    setMusic(on, energy) {
      state.ctx.energy = energy || .6;
      if (on === state.music) return;
      state.music = on;
      if (on) { state.musicVariantAt = now(); api.setLoop(state.musicVariant); }
      else if (!state.transition) api.setLoop(state.userLoop || 'idle');
    },
    setMusicPaused(paused) { if (!state.music) return; api.setLoop(paused ? 'music_paused' : state.musicVariant); },
    setTheme(name) { baseHue = THEMES[name] ?? THEMES.cyan; baseSat = name === 'white' ? 10 : 95; },
    setHidden(h) { state.hidden = h; },
    list: () => Object.keys(A),
    meta: (n) => (A[n] && A[n].meta) || {},
  };
  window.NexEyes = api;

  const now = () => performance.now() / 1000;
  function beginLoop(name) { state.prevLoop = state.loopName; state.prevLoopStart = state.loopStart; state.loopName = name; state.loopStart = now(); }
  function tickTransition(t) {
    const tr = state.transition; if (!tr) return;
    for (const st of tr.steps) { if (!st.fired && t >= st.start) { st.fired = true; state.shots = state.shots.filter(x => x.name !== st.name); state.shots.push({ name: st.name, start: t, transition: true }); } }
    if (!tr.started && t >= tr.switchAt) { tr.started = true; beginLoop(tr.target); }
    const done = tr.steps.every(x => x.fired && t >= x.start + x.dur);
    if (tr.started && done) state.transition = null;
  }

  // pointer tracking (eyes follow cursor)
  window.addEventListener('mousemove', (e) => { state.mouse.x = e.clientX; state.mouse.y = e.clientY; state.mouse.active = true; state.mouse.last = now(); });
  window.addEventListener('mouseleave', () => { state.mouse.active = false; });

  // ---------- pose blending ----------
  function basePose() {
    return { lx: 0, ly: 0, rx: 0, ry: 0, lw: 1, lh: 1, rw: 1, rh: 1, lr: 0, rr: 0, lidT: 0, lidB: 0, lLidT: 0, rLidT: 0, squint: 0, glow: 1, hue: 0, bodyX: 0, bodyY: 0, bodyR: 0, shape: 'rect', props: [], propAnim: 0 };
  }
  const NUM = ['lx', 'ly', 'rx', 'ry', 'lw', 'lh', 'rw', 'rh', 'lr', 'rr', 'lidT', 'lidB', 'lLidT', 'rLidT', 'squint', 'glow', 'hue', 'bodyX', 'bodyY', 'bodyR'];

  function merge(into, p, weight = 1) {
    if (!p) return;
    for (const k of NUM) if (p[k] !== undefined) {
      if (k.startsWith('l') && k.length === 2 && (k[1] === 'w' || k[1] === 'h') || (k.startsWith('r') && k.length === 2 && (k[1] === 'w' || k[1] === 'h')) || k === 'glow') into[k] = into[k] * (1 - weight) + p[k] * weight; // multiplicative-ish fields blend toward
      else if (k === 'lidT' || k === 'lidB' || k === 'lLidT' || k === 'rLidT' || k === 'squint') into[k] = Math.max(into[k], p[k] * weight);
      else into[k] += p[k] * weight;
    }
    if (p.shape && weight > .5) into.shape = p.shape;
    if (p.props) { for (const pr of p.props) if (!into.props.includes(pr)) into.props.push(pr); into.propAnim = p.propAnim ?? into.propAnim; }
    into.propW = Math.max(into.propW || 0, weight);
  }

  function computePose(t) {
    const pose = basePose();
    // loop
    let loopName = state.loopName;
    if (state.music && (A[loopName].meta || {}).family === 'music' && loopName !== 'music_paused' && t - state.musicVariantAt > 14) {
      let v; do { v = MUSIC_VARIANTS[(Math.random() * MUSIC_VARIANTS.length) | 0]; } while (v === state.musicVariant);
      state.musicVariant = v; state.musicVariantAt = t; api.setLoop(v);
    }
    tickTransition(t);
    const lt = t - state.loopStart;
    const xf = Math.min(1, lt / state.crossfade);
    const inTransition = state.transition && !state.transition.started;
    if (state.prevLoop && xf < 1 && A[state.prevLoop]) merge(pose, A[state.prevLoop](t - state.prevLoopStart, state.ctx), 1 - ease(xf));
    // while an exit clip is playing, damp the old loop so the exit clip reads clearly
    merge(pose, A[loopName] ? A[loopName](lt, state.ctx) : A.idle(lt, state.ctx), inTransition ? .35 * ease(xf) : ease(xf));

    // one-shots
    state.shots = state.shots.filter(s => {
      const def = A[s.name];
      const st = t - s.start;
      const p = def(st, state.ctx);
      const dur = p.duration || 1;
      if (st > dur) return false;
      const w = s.transition ? Math.min(1, st / .08) : Math.min(1, st / .12) * Math.min(1, (dur - st) / .25);
      merge(pose, p, w);
      return true;
    });

    // micro behaviour: auto blink / fidget while idle
    if (t - state.lastBlink > state.nextBlink && pose.lidT < .5) { state.lastBlink = t; state.nextBlink = 2 + Math.random() * 5; api.play(Math.random() < .12 ? 'double_blink' : 'blink'); }
    if (state.loopName === 'idle' && !state.music && !state.transition && t - state.lastFidget > state.nextFidget) {
      state.lastFidget = t; state.nextFidget = 5 + Math.random() * 9;
      const f = IDLE_FIDGETS[(Math.random() * IDLE_FIDGETS.length) | 0];
      if ((A[f].meta || {}).kind === 'loop') { api.setLoop(f); setTimeout(() => { if (state.loopName === f) api.setLoop('idle'); }, 4500); }
      else api.play(f);
    }
    // cursor follow (subtle, only while idle-ish)
    if (state.mouse.active && t - state.mouse.last < 6 && !state.music) {
      const dx = (state.mouse.x - W / 2) / W, dy = (state.mouse.y - H / 2) / H;
      const k = state.loopName === 'idle' ? 22 : 8;
      pose.lx += dx * k; pose.rx += dx * k; pose.ly += dy * k * .8; pose.ry += dy * k * .8;
    }
    return pose;
  }

  // smoothing
  function smooth(target, dt) {
    const c = state.cur;
    const k = 1 - Math.pow(0.0005, dt); // fast but soft
    for (const key of NUM) { if (c[key] === undefined) c[key] = target[key]; c[key] += (target[key] - c[key]) * (key.includes('Lid') || key === 'lidT' || key === 'lidB' ? Math.min(1, k * 2.2) : k); }
    c.shape = target.shape; c.props = target.props; c.propAnim = target.propAnim; c.propW = target.propW;
    return c;
  }

  // ---------- drawing ----------
  function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y + h, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function eyePath(shape, w, h, r) {
    const hw = w / 2, hh = h / 2;
    ctx.beginPath();
    switch (shape) {
      case 'happy': // rounded top, flat-ish bottom arc (smile)
        ctx.moveTo(-hw, hh * .35); ctx.arcTo(-hw, -hh, hw, -hh, r); ctx.arcTo(hw, -hh, hw, hh * .35, r); ctx.lineTo(hw, hh * .35);
        ctx.quadraticCurveTo(0, hh * -.3, -hw, hh * .35); ctx.closePath(); break;
      case 'sad':
        ctx.moveTo(-hw, -hh * .2); ctx.quadraticCurveTo(0, hh * .45, hw, -hh * .2); ctx.arcTo(hw, hh, -hw, hh, r); ctx.arcTo(-hw, hh, -hw, -hh, r); ctx.closePath(); break;
      case 'angry': return null; // handled via lids
      case 'surprised': case 'wide': ctx.ellipse(0, 0, hw * .95, hh, 0, 0, Math.PI * 2); break;
      case 'dot': ctx.ellipse(0, 0, hw * .45, hh * .35, 0, 0, Math.PI * 2); break;
      case 'heart': {
        const s = Math.min(w, h) * .55; ctx.moveTo(0, s * .9);
        ctx.bezierCurveTo(-s * 1.4, 0, -s * .8, -s * .95, 0, -s * .35); ctx.bezierCurveTo(s * .8, -s * .95, s * 1.4, 0, 0, s * .9); ctx.closePath(); break;
      }
      case 'star': { const R = Math.min(w, h) * .55, rI = R * .48; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 ? rI : R; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); } ctx.closePath(); break; }
      case 'x': return 'x';
      case 'focus': rr(-hw, -hh * .55, w, h * 1.1, r); break;
      case 'sleepy': rr(-hw, -hh * .15, w, h * .3, r); break;
      default: rr(-hw, -hh, w, h, r);
    }
    return true;
  }

  function drawEye(side, pose, hue, cx, cy) {
    const isL = side === 'l';
    const ox = pose[isL ? 'lx' : 'rx'], oy = pose[isL ? 'ly' : 'ry'];
    const sw = pose[isL ? 'lw' : 'rw'], sh = pose[isL ? 'lh' : 'rh'];
    const rot = pose[isL ? 'lr' : 'rr'];
    const w = EYE.w * sw, h = EYE.h * sh;
    const lidT = Math.max(pose.lidT, pose[isL ? 'lLidT' : 'rLidT'], pose.squint * .5);
    const lidB = Math.max(pose.lidB, pose.squint * .4);
    const shape = pose.shape;
    const glow = pose.glow;
    const col = `hsl(${hue} ${baseSat}% 62%)`, colD = `hsl(${hue} ${baseSat}% 45%)`, colL = `hsl(${hue} 100% 88%)`;

    ctx.save();
    ctx.translate(cx + ox, cy + oy); ctx.rotate(rot);
    // glow
    ctx.shadowColor = `hsl(${hue} 100% 60%)`; ctx.shadowBlur = 28 * glow * state.scale;

    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, colL); grad.addColorStop(.45, col); grad.addColorStop(1, colD);
    ctx.fillStyle = grad;

    const r = eyePath(shape, w, h, EYE.radius);
    if (r === 'x') {
      ctx.lineCap = 'round'; ctx.lineWidth = w * .22; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(-w * .35, -h * .3); ctx.lineTo(w * .35, h * .3); ctx.moveTo(w * .35, -h * .3); ctx.lineTo(-w * .35, h * .3); ctx.stroke();
      ctx.restore(); return;
    }
    if (r === null) { rr(-w / 2, -h / 2, w, h, EYE.radius); }
    ctx.fill();
    ctx.shadowBlur = 0;

    // clip for lids + highlights
    ctx.save();
    if (r === null) rr(-w / 2, -h / 2, w, h, EYE.radius); else eyePath(shape, w, h, EYE.radius);
    ctx.clip();
    // inner highlight
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    rr(-w * .32, -h * .42, w * .22, h * .3, EYE.radius * .5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    rr(-w * .32, -h * .05, w * .12, h * .12, EYE.radius * .4); ctx.fill();
    // lids (background colour)
    ctx.fillStyle = '#07090f';
    if (shape === 'angry') { // slanted lid
      const slant = isL ? 1 : -1; ctx.beginPath(); ctx.moveTo(-w, -h); ctx.lineTo(w, -h);
      ctx.lineTo(w, -h / 2 + (slant > 0 ? h * .55 : h * .05) + lidT * h); ctx.lineTo(-w, -h / 2 + (slant > 0 ? h * .05 : h * .55) + lidT * h); ctx.closePath(); ctx.fill();
    } else if (lidT > 0.001) { ctx.fillRect(-w, -h, w * 2, h + lidT * h); }
    if (lidB > 0.001) { ctx.fillRect(-w, h / 2 - lidB * h, w * 2, h); }
    ctx.restore();
    ctx.restore();
  }

  // ---------- props ----------
  const P = {};
  P.headset = (t, w, cx, cy, hue) => {
    const s = state.scale; const a = Math.min(1, typeof t === 'number' && t <= 1 ? Math.max(0, t) : 1);
    const span = EYE.gap / 2 + EYE.w + 40 * s;
    ctx.save(); ctx.globalAlpha *= Math.min(1, a * 1.5); ctx.translate(cx, cy - (1 - a) * 140);
    ctx.lineCap = 'round'; ctx.lineWidth = 16 * s; ctx.strokeStyle = '#1b2230';
    ctx.beginPath(); ctx.arc(0, 30 * s, span, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.lineWidth = 6 * s; ctx.strokeStyle = `hsl(${hue} 90% 60%)`; ctx.beginPath(); ctx.arc(0, 30 * s, span, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#1b2230'; rr(side * span - 34 * s, -20 * s, 68 * s, 120 * s, 22 * s); ctx.fill();
      ctx.fillStyle = `hsl(${hue} 90% 55%)`; ctx.shadowColor = `hsl(${hue} 100% 60%)`; ctx.shadowBlur = 20 * s;
      rr(side * span - 20 * s, 8 * s, 40 * s, 64 * s, 14 * s); ctx.fill(); ctx.shadowBlur = 0;
      // pulsing led
      ctx.fillStyle = `hsl(${hue} 100% ${70 + Math.sin(now() * 8) * 25}%)`; ctx.beginPath(); ctx.arc(side * span, 90 * s, 4 * s, 0, 7); ctx.fill();
    }
    ctx.restore();
  };
  P.notes = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${34 * s}px serif`; ctx.textAlign = 'center'; for (let i = 0; i < 4; i++) { const p = ((t * .35 + i * .27) % 1); const x = cx + (i % 2 ? 1 : -1) * (EYE.gap / 2 + EYE.w + 60 * s + Math.sin(p * 6 + i) * 20 * s); const y = cy + 40 * s - p * 200 * s; ctx.globalAlpha = (1 - p) * .9; ctx.fillStyle = `hsl(${hue + i * 30} 90% 70%)`; ctx.fillText(['♪', '♫', '♩', '♬'][i], x, y); } ctx.restore(); };
  P.zzz = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `bold ${30 * s}px sans-serif`; ctx.fillStyle = `hsl(${hue} 80% 75%)`; for (let i = 0; i < 3; i++) { const p = ((t * .4 + i * .33) % 1); ctx.globalAlpha = 1 - p; ctx.font = `bold ${(22 + p * 22) * s}px sans-serif`; ctx.fillText('z', cx + EYE.gap / 2 + EYE.w + 30 * s + p * 60 * s, cy - 40 * s - p * 120 * s); } ctx.restore(); };
  P.dots = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); for (let i = 0; i < 3; i++) { const p = Math.max(0, Math.sin(t * 4 - i * .8)); ctx.fillStyle = `hsl(${hue} 90% ${55 + p * 30}%)`; ctx.beginPath(); ctx.arc(cx + EYE.gap / 2 + EYE.w + 50 * s + i * 22 * s, cy - EYE.h / 2 - 40 * s - p * 10 * s, 6 * s + p * 3 * s, 0, 7); ctx.fill(); } ctx.restore(); };
  P.bulb = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy - EYE.h / 2 - 90 * s; const g = .6 + Math.sin(t * 6) * .4; ctx.save(); ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 40 * g * s; ctx.fillStyle = `hsl(48 100% ${60 + g * 25}%)`; ctx.beginPath(); ctx.arc(cx, y, 26 * s, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#9aa3b2'; rr(cx - 12 * s, y + 20 * s, 24 * s, 16 * s, 4 * s); ctx.fill(); ctx.strokeStyle = `hsl(48 100% 70%)`; ctx.lineWidth = 3 * s; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + t; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 40 * s, y + Math.sin(a) * 40 * s); ctx.lineTo(cx + Math.cos(a) * (48 + g * 10) * s, y + Math.sin(a) * (48 + g * 10) * s); ctx.stroke(); } ctx.restore(); };
  P.gear = (t, w, cx, cy, hue) => { const s = state.scale; const x = cx + EYE.gap / 2 + EYE.w + 60 * s, y = cy - EYE.h / 2 - 20 * s; ctx.save(); ctx.translate(x, y); ctx.rotate(t * 2); ctx.fillStyle = `hsl(${hue} 60% 65%)`; for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-6 * s, -30 * s, 12 * s, 14 * s); } ctx.beginPath(); ctx.arc(0, 0, 20 * s, 0, 7); ctx.fill(); ctx.fillStyle = '#07090f'; ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, 7); ctx.fill(); ctx.restore(); };
  P.pencil = (t, w, cx, cy, hue) => { const s = state.scale; const x = cx + Math.sin(t * 6) * 40 * s, y = cy + EYE.h / 2 + 50 * s + Math.abs(Math.cos(t * 12)) * 6 * s; ctx.save(); ctx.translate(x, y); ctx.rotate(-.7 + Math.sin(t * 6) * .1); ctx.fillStyle = '#ffcf5a'; rr(-8 * s, -60 * s, 16 * s, 70 * s, 3 * s); ctx.fill(); ctx.fillStyle = '#f5b8c0'; rr(-8 * s, -70 * s, 16 * s, 12 * s, 3 * s); ctx.fill(); ctx.fillStyle = '#e8d6b8'; ctx.beginPath(); ctx.moveTo(-8 * s, 10 * s); ctx.lineTo(8 * s, 10 * s); ctx.lineTo(0, 26 * s); ctx.fill(); ctx.fillStyle = '#333'; ctx.beginPath(); ctx.moveTo(-3 * s, 20 * s); ctx.lineTo(3 * s, 20 * s); ctx.lineTo(0, 26 * s); ctx.fill(); ctx.restore(); };
  P.book = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy + EYE.h / 2 + 60 * s; ctx.save(); ctx.fillStyle = `hsl(${hue} 50% 30%)`; rr(cx - 90 * s, y, 180 * s, 60 * s, 8 * s); ctx.fill(); ctx.fillStyle = '#f0ead8'; rr(cx - 82 * s, y + 6 * s, 80 * s, 48 * s, 4 * s); ctx.fill(); rr(cx + 2 * s, y + 6 * s, 80 * s, 48 * s, 4 * s); ctx.fill(); ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2 * s; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(cx - 74 * s, y + (16 + i * 9) * s); ctx.lineTo(cx - 14 * s, y + (16 + i * 9) * s); ctx.moveTo(cx + 10 * s, y + (16 + i * 9) * s); ctx.lineTo(cx + 70 * s, y + (16 + i * 9) * s); ctx.stroke(); } ctx.restore(); };
  P.magnifier = (t, w, cx, cy, hue) => { const s = state.scale; const x = cx + EYE.gap / 2 + Math.sin(t * 3) * 30 * s, y = cy + Math.cos(t * 2) * 20 * s; ctx.save(); ctx.strokeStyle = '#dfe6f0'; ctx.lineWidth = 8 * s; ctx.beginPath(); ctx.arc(x, y, 40 * s, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(180,220,255,.15)'; ctx.fill(); ctx.lineCap = 'round'; ctx.lineWidth = 12 * s; ctx.beginPath(); ctx.moveTo(x + 30 * s, y + 30 * s); ctx.lineTo(x + 65 * s, y + 65 * s); ctx.stroke(); ctx.restore(); };
  P.check = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' && t <= 1 ? t : 1; const x = cx + EYE.gap / 2 + EYE.w + 70 * s, y = cy - EYE.h / 2 - 30 * s; ctx.save(); ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 20 * s; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 12 * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x - 30 * s, y); if (p > .4) ctx.lineTo(x - 30 * s + 25 * s * Math.min(1, (p - .4) / .3), y + 25 * s * Math.min(1, (p - .4) / .3)); if (p > .7) ctx.lineTo(x - 5 * s + 45 * s * Math.min(1, (p - .7) / .3), y + 25 * s - 55 * s * Math.min(1, (p - .7) / .3)); ctx.stroke(); ctx.restore(); };
  P.cross = (t, w, cx, cy, hue) => { const s = state.scale; const x = cx + EYE.gap / 2 + EYE.w + 70 * s, y = cy - EYE.h / 2 - 30 * s; ctx.save(); ctx.shadowColor = '#f87171'; ctx.shadowBlur = 20 * s; ctx.strokeStyle = '#f87171'; ctx.lineWidth = 12 * s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 25 * s, y - 25 * s); ctx.lineTo(x + 25 * s, y + 25 * s); ctx.moveTo(x + 25 * s, y - 25 * s); ctx.lineTo(x - 25 * s, y + 25 * s); ctx.stroke(); ctx.restore(); };
  P.scale = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy - EYE.h / 2 - 80 * s; const tilt = Math.sin(t * 1.5) * .18; ctx.save(); ctx.translate(cx, y); ctx.strokeStyle = '#d9c68a'; ctx.fillStyle = '#d9c68a'; ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.moveTo(0, -20 * s); ctx.lineTo(0, 40 * s); ctx.stroke(); ctx.rotate(tilt); ctx.beginPath(); ctx.moveTo(-70 * s, -20 * s); ctx.lineTo(70 * s, -20 * s); ctx.stroke(); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 70 * s, -20 * s); ctx.lineTo(sd * 55 * s, 15 * s); ctx.moveTo(sd * 70 * s, -20 * s); ctx.lineTo(sd * 85 * s, 15 * s); ctx.stroke(); ctx.beginPath(); ctx.arc(sd * 70 * s, 15 * s, 22 * s, 0, Math.PI); ctx.fill(); } ctx.restore(); };
  P.exclaim = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy - EYE.h / 2 - 90 * s + Math.sin(t * 12) * 4 * s; ctx.save(); ctx.font = `bold ${90 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 20 * s; ctx.fillStyle = '#fbbf24'; ctx.fillText('!', cx + EYE.gap / 2 + EYE.w * .5, y + 30 * s); ctx.restore(); };
  P.question = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy - EYE.h / 2 - 80 * s + Math.sin(t * 3) * 6 * s; ctx.save(); ctx.font = `bold ${80 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = `hsl(${hue} 90% 75%)`; ctx.shadowColor = `hsl(${hue} 90% 60%)`; ctx.shadowBlur = 20 * s; ctx.fillText('?', cx + EYE.gap / 2 + EYE.w * .6, y + 30 * s); ctx.restore(); };
  P.heart = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${40 * s}px serif`; ctx.textAlign = 'center'; for (let i = 0; i < 5; i++) { const p = ((t * .4 + i * .2) % 1); ctx.globalAlpha = 1 - p; ctx.fillStyle = `hsl(${340 + i * 10} 90% 65%)`; ctx.fillText('♥', cx + (i - 2) * 70 * s + Math.sin(p * 5 + i) * 15 * s, cy - EYE.h / 2 - 20 * s - p * 160 * s); } ctx.restore(); };
  P.sparks = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); for (let i = 0; i < 14; i++) { const p = ((t * .8 + i * .071) % 1); const a = i * 2.39 + t; const R = (EYE.w + EYE.gap / 2) * (1 + p * .6); ctx.globalAlpha = 1 - p; ctx.fillStyle = `hsl(${(hue + i * 25) % 360} 100% 70%)`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R * .7, (2 + (1 - p) * 4) * s, 0, 7); ctx.fill(); } ctx.restore(); };
  P.confetti = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); for (let i = 0; i < 40; i++) { const p = ((t * .35 + i * .0251) % 1); const x = cx + ((i * 97) % 700 - 350) * s + Math.sin(p * 8 + i) * 30 * s; const y = cy - 300 * s + p * 640 * s; ctx.globalAlpha = 1 - p * .6; ctx.fillStyle = `hsl(${(i * 47) % 360} 90% 60%)`; ctx.save(); ctx.translate(x, y); ctx.rotate(p * 10 + i); ctx.fillRect(-6 * s, -3 * s, 12 * s, 6 * s); ctx.restore(); } ctx.restore(); };
  P.tears = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const p = ((t * .7 + i * .33) % 1); const x = cx + sd * (EYE.gap / 2 + EYE.w * .5) + sd * 20 * s; ctx.globalAlpha = 1 - p; ctx.fillStyle = '#7dd3fc'; ctx.beginPath(); ctx.ellipse(x, cy + EYE.h / 2 + p * 120 * s, 6 * s, 10 * s, 0, 0, 7); ctx.fill(); } ctx.restore(); };
  P.thumbup = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' && t <= 1 ? t : 1; ctx.save(); ctx.globalAlpha = Math.min(1, p * 2); ctx.font = `${80 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('👍', cx + EYE.gap / 2 + EYE.w + 80 * s, cy - EYE.h / 2 + 10 * s - (1 - p) * 30 * s); ctx.restore(); };
  P.thumbdown = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${80 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('👎', cx + EYE.gap / 2 + EYE.w + 80 * s, cy + EYE.h / 2 + Math.sin(t * 6) * 4 * s); ctx.restore(); };
  P.shield = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' && t <= 1 ? t : 1; ctx.save(); ctx.globalAlpha = p; ctx.translate(cx, cy); ctx.scale(1 + (1 - p) * .5, 1 + (1 - p) * .5); ctx.strokeStyle = `hsl(45 100% 60%)`; ctx.lineWidth = 8 * s; ctx.shadowColor = `hsl(45 100% 60%)`; ctx.shadowBlur = 30 * s; const R = EYE.gap / 2 + EYE.w + 50 * s; ctx.beginPath(); ctx.moveTo(-R, -R * .7); ctx.lineTo(R, -R * .7); ctx.lineTo(R, R * .2); ctx.quadraticCurveTo(R, R * .8, 0, R); ctx.quadraticCurveTo(-R, R * .8, -R, R * .2); ctx.closePath(); ctx.stroke(); ctx.restore(); };
  P.plug = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${60 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🔌', cx + EYE.gap / 2 + EYE.w + 70 * s, cy - EYE.h / 2 + 10 * s); ctx.restore(); };
  P.clock = (t, w, cx, cy, hue) => { const s = state.scale; const x = cx + EYE.gap / 2 + EYE.w + 70 * s, y = cy - EYE.h / 2 - 20 * s; ctx.save(); ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.arc(x, y, 30 * s, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t * 6 - Math.PI / 2) * 22 * s, y + Math.sin(t * 6 - Math.PI / 2) * 22 * s); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t * .5 - Math.PI / 2) * 14 * s, y + Math.sin(t * .5 - Math.PI / 2) * 14 * s); ctx.stroke(); ctx.restore(); };
  P.wrench = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.translate(cx + EYE.gap / 2 + EYE.w + 60 * s, cy); ctx.rotate(Math.sin(t * 8) * .6); ctx.font = `${70 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🔧', 0, 20 * s); ctx.restore(); };
  P.bug = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${56 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🐛', cx - EYE.gap / 2 - EYE.w - 60 * s + Math.sin(t * 5) * 10 * s, cy + Math.cos(t * 7) * 6 * s); ctx.restore(); };
  P.brain = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${70 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.globalAlpha = .8 + Math.sin(t * 5) * .2; ctx.fillText('🧠', cx, cy - EYE.h / 2 - 60 * s); ctx.restore(); };
  P.gamepad = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${74 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🎮', cx, cy + EYE.h / 2 + 70 * s + Math.sin(t * 6) * 4 * s); ctx.restore(); };
  P.clipboard = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy + EYE.h / 2 + 50 * s; ctx.save(); ctx.fillStyle = '#c7a26b'; rr(cx - 60 * s, y, 120 * s, 80 * s, 8 * s); ctx.fill(); ctx.fillStyle = '#f7f3e9'; rr(cx - 50 * s, y + 12 * s, 100 * s, 60 * s, 4 * s); ctx.fill(); ctx.strokeStyle = `hsl(${hue} 70% 50%)`; ctx.lineWidth = 3 * s; for (let i = 0; i < 4; i++) { const done = (t * .6) % 5 > i + 1; ctx.strokeRect(cx - 42 * s, y + (20 + i * 12) * s, 8 * s, 8 * s); if (done) { ctx.beginPath(); ctx.moveTo(cx - 42 * s, y + (24 + i * 12) * s); ctx.lineTo(cx - 38 * s, y + (28 + i * 12) * s); ctx.lineTo(cx - 32 * s, y + (20 + i * 12) * s); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(cx - 28 * s, y + (24 + i * 12) * s); ctx.lineTo(cx + 40 * s, y + (24 + i * 12) * s); ctx.stroke(); } ctx.restore(); };
  P.wave = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.strokeStyle = `hsl(${hue} 90% 65%)`; ctx.lineWidth = 3 * s; ctx.lineCap = 'round'; for (const sd of [-1, 1]) { const x0 = cx + sd * (EYE.gap / 2 + EYE.w + 40 * s); for (let i = 0; i < 3; i++) { const ph = t * 5 + i; const h = (10 + i * 6) * s * (0.6 + Math.sin(ph) * .4); ctx.globalAlpha = .9 - i * .25; ctx.beginPath(); ctx.moveTo(x0 + sd * i * 14 * s, cy - h); ctx.lineTo(x0 + sd * i * 14 * s, cy + h); ctx.stroke(); } } ctx.restore(); };
  P.wave_hand = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.translate(cx + EYE.gap / 2 + EYE.w + 80 * s, cy - EYE.h / 2); ctx.rotate(Math.sin(t * 10) * .4); ctx.font = `${70 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('👋', 0, 20 * s); ctx.restore(); };
  P.stars_orbit = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${30 * s}px sans-serif`; ctx.textAlign = 'center'; for (let i = 0; i < 4; i++) { const a = t * 4 + i * Math.PI / 2; ctx.fillText('⭐', cx + Math.cos(a) * (EYE.gap / 2 + EYE.w * .8), cy - EYE.h / 2 - 40 * s + Math.sin(a) * 18 * s); } ctx.restore(); };
  P.vol_up = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${60 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🔊', cx, cy - EYE.h / 2 - 70 * s - t * 20 * s); ctx.restore(); };
  P.vol_down = (t, w, cx, cy, hue) => { const s = state.scale; ctx.save(); ctx.font = `${60 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🔉', cx, cy - EYE.h / 2 - 70 * s + t * 20 * s); ctx.restore(); };


  // --- props for the new batch ---
  P.keyboard = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy + EYE.h / 2 + 46 * s; ctx.save(); ctx.fillStyle = '#161c28'; rr(cx - 150 * s, y, 300 * s, 54 * s, 10 * s); ctx.fill(); for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) { const k = (i * 7 + r * 13 + Math.floor(t * 14)) % 9 === 0; ctx.fillStyle = k ? `hsl(${hue} 90% 65%)` : '#2a3344'; if (k) { ctx.shadowColor = `hsl(${hue} 90% 60%)`; ctx.shadowBlur = 10 * s; } else ctx.shadowBlur = 0; rr(cx - 140 * s + i * 24 * s + r * 6 * s, y + 6 * s + r * 15 * s, 18 * s, 11 * s, 3 * s); ctx.fill(); } ctx.restore(); };
  P.progress = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' ? t : 0; const y = cy + EYE.h / 2 + 50 * s, W2 = 260 * s; ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(cx - W2 / 2, y, W2, 12 * s, 6 * s); ctx.fill(); ctx.fillStyle = `hsl(${hue} 90% 60%)`; ctx.shadowColor = `hsl(${hue} 90% 60%)`; ctx.shadowBlur = 14 * s; rr(cx - W2 / 2, y, W2 * Math.max(.02, p), 12 * s, 6 * s); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${11 * s}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.fillText(Math.round(p * 100) + '%', cx, y + 30 * s); ctx.restore(); };
  P.laser = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' ? t : 0; const y = cy - EYE.h / 2 - 20 * s + p * (EYE.h + 40 * s); const span = EYE.gap / 2 + EYE.w + 30 * s; ctx.save(); ctx.strokeStyle = `hsl(${(hue + 20) % 360} 100% 65%)`; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 24 * s; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(cx - span, y); ctx.lineTo(cx + span, y); ctx.stroke(); ctx.globalAlpha = .25; ctx.lineWidth = 18 * s; ctx.stroke(); ctx.restore(); };
  P.hand_cover = (t, w, cx, cy, hue) => { const s = state.scale; const p = typeof t === 'number' ? t : 1; ctx.save(); ctx.globalAlpha = p; ctx.translate(cx - EYE.gap / 2 - EYE.w / 2, cy - EYE.h / 2 + 20 * s - (1 - p) * 80 * s); ctx.rotate(.25); ctx.font = `${120 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🤚', 0, 40 * s); ctx.restore(); };
  P.cloud = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy - EYE.h / 2 - 110 * s; ctx.save(); ctx.fillStyle = '#6b7a90'; for (const [dx, r] of [[-40, 28], [-10, 38], [30, 30], [55, 22]]) { ctx.beginPath(); ctx.arc(cx + dx * s + Math.sin(t) * 6 * s, y, r * s, 0, 7); ctx.fill(); } ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 3 * s; ctx.lineCap = 'round'; for (let i = 0; i < 9; i++) { const p = ((t * 1.3 + i * .11) % 1); ctx.globalAlpha = 1 - p; const x = cx + (-50 + i * 13) * s + Math.sin(t) * 6 * s; ctx.beginPath(); ctx.moveTo(x, y + 30 * s + p * 150 * s); ctx.lineTo(x - 3 * s, y + 44 * s + p * 150 * s); ctx.stroke(); } ctx.restore(); };
  P.hand_headset = (t, w, cx, cy, hue) => { const s = state.scale; const span = EYE.gap / 2 + EYE.w + 40 * s; ctx.save(); ctx.translate(cx - span - 30 * s, cy + 10 * s + Math.sin(t * 6) * 3 * s); ctx.rotate(-.5); ctx.font = `${90 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('🤚', 0, 30 * s); ctx.restore(); };
  P.equalizer = (t, w, cx, cy, hue) => { const s = state.scale; const y = cy + EYE.h / 2 + 60 * s; ctx.save(); for (let i = 0; i < 16; i++) { const h = (6 + abs(Math.sin(t * 7 + i * 1.3) * Math.sin(t * 3 + i)) * 40) * s; ctx.fillStyle = `hsl(${(hue + i * 12) % 360} 90% 60%)`; rr(cx - 120 * s + i * 15 * s, y - h, 10 * s, h, 3 * s); ctx.fill(); } ctx.restore(); };

  P.agents = (t, w, cx, cy, hue) => { const s = state.scale; const names = [['D', 200], ['T', 275], ['A', 330], ['Q', 140]]; const y = cy - EYE.h / 2 - 70 * s; ctx.save(); names.forEach(([n, h], i) => { const active = Math.floor(t * 1.1) % 4 === i; const x = cx + (i - 1.5) * 64 * s; const r = (14 + (active ? 4 : 0)) * s; ctx.fillStyle = `hsl(${h} 80% ${active ? 65 : 30}%)`; if (active) { ctx.shadowColor = `hsl(${h} 90% 60%)`; ctx.shadowBlur = 22 * s; } ctx.beginPath(); ctx.arc(x, y + (active ? -4 : 0) * s, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = active ? '#000' : 'rgba(255,255,255,.5)'; ctx.font = `bold ${13 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, x, y + (active ? -4 : 0) * s); if (i < 3) { ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + 64 * s - r, y); ctx.stroke(); } }); ctx.restore(); };

  // ---------- main loop ----------
  let last = now();
  function frame() {
    requestAnimationFrame(frame);
    const t = now(); const dt = Math.min(.05, t - last); last = t;
    ctx.clearRect(0, 0, W, H);
    if (state.hidden) return;
    const target = computePose(t);
    const pose = smooth(target, dt);
    const hue = (baseHue + pose.hue + 360) % 360;
    const cx = W / 2 + pose.bodyX, cy = H / 2 - 20 + pose.bodyY;

    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(pose.bodyR); ctx.translate(-cx, -cy);
    // props behind (headset band)
    if (pose.props.includes('headset')) P.headset(pose.propAnim, W, cx, cy, hue);
    else if (state.propAlpha.headset) { ctx.globalAlpha = state.propAlpha.headset; P.headset(1, W, cx, cy, hue); ctx.globalAlpha = 1; }
    drawEye('l', pose, hue, cx - EYE.gap / 2 - EYE.w / 2, cy);
    drawEye('r', pose, hue, cx + EYE.gap / 2 + EYE.w / 2, cy);
    // per-prop alpha fade (in .18s / out .35s) so props never pop
    const want = new Set(pose.props);
    for (const p of want) state.propAlpha[p] = Math.min(1, (state.propAlpha[p] || 0) + dt / .18);
    for (const p in state.propAlpha) if (!want.has(p)) { state.propAlpha[p] -= dt / .35; if (state.propAlpha[p] <= 0) delete state.propAlpha[p]; }
    for (const p in state.propAlpha) { if (p === 'headset' || !P[p]) continue; ctx.globalAlpha = state.propAlpha[p] * Math.min(1, pose.propW || 1); P[p](pose.propAnim, W, cx, cy, hue); }
    ctx.globalAlpha = 1;
    ctx.restore();

    // beat phase for music from a simple internal clock unless provided
    state.ctx.beat = (t * 1.9) % 1;
  }
  frame();
})();
