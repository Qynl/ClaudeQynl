/* NEX · eyes renderer v3 — spring pose engine, white on black */
(() => {
  const { C, STATE, FIDGETS, MUSIC } = window.NexClips;
  const cv = document.getElementById('eyes'), ctx = cv.getContext('2d');
  let W = 0, H = 0, S = 1;
  const now = () => performance.now() / 1000; const TAU = Math.PI * 2, sin = Math.sin, abs = Math.abs;

  // ---------------- geometry
  const G = { w: 200, h: 140, gap: 84, r: 30 };
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(W / 640, H / 480, 1.5);
  }
  addEventListener('resize', resize); resize();

  // ---------------- pose + springs
  const NUM = { x: 0, y: 0, sx: 1, sy: 1, lid: 0, lidL: 0, lidR: 0, lower: 0, tilt: 0, px: 0, py: 0, glow: 1 };
  const PROPS = ['headset', 'dots', 'spinner', 'check', 'cross', 'bulb', 'wave', 'bars', 'note'];
  const SHAPES = ['rect', 'happy', 'sad', 'angry', 'focus', 'surprised', 'closed'];
  const stiff = { x: 120, y: 120, sx: 160, sy: 160, lid: 380, lidL: 380, lidR: 380, lower: 300, tilt: 90, px: 70, py: 90, glow: 40 };
  const pose = Object.assign({}, NUM), vel = {}; for (const k in NUM) vel[k] = 0;
  const shapeW = {}; SHAPES.forEach(s => shapeW[s] = s === 'rect' ? 1 : 0);
  const propA = {}; PROPS.forEach(p => propA[p] = 0);

  function spring(k, target, dt) {
    const s = stiff[k], d = 2 * Math.sqrt(s) * .92;           // slightly under-damped
    const a = s * (target - pose[k]) - d * vel[k];
    vel[k] += a * dt; pose[k] += vel[k] * dt;
  }

  // ---------------- state
  const st = { loop: 'idle', loopT0: now(), prev: null, prevT0: 0, shots: [], pending: null, music: false, variant: 'music', variantT: 0,
               lastBlink: 0, nextBlink: 3, lastFidget: 0, nextFidget: 6, mouse: null, ctx: { beat: 0 } };

  function startLoop(n) { st.prev = st.loop; st.prevT0 = st.loopT0; st.loop = n; st.loopT0 = now(); }
  function play(n, opts = {}) { if (!C[n] || C[n].loop) return; st.shots = st.shots.filter(s => s.n !== n); st.shots.push({ n, t0: now() + (opts.delay || 0), w: opts.weight || 1 }); }

  function setLoop(n) {
    if (!C[n] || !C[n].loop) return;
    const target = st.pending ? st.pending.to : st.loop;
    if (n === target) return;
    const from = C[st.loop], to = C[n];
    const sameFam = (from.exit && from.exit === to.exit) || (from.enter && from.enter === to.enter);
    let delay = 0; const t0 = now();
    if (!sameFam && from.exit) { play(from.exit); delay += C[from.exit].dur * .55; }
    if (!sameFam && to.enter) { play(to.enter, { delay }); delay += C[to.enter].dur * .45; }
    st.pending = { to: n, at: t0 + delay };
  }

  const api = {
    setState(s, anim) { const n = (anim && C[anim]) ? anim : (STATE[s] || 'idle'); if (!C[n].loop) { play(n); return; } st.userLoop = n; if (st.music && n === 'idle') return; setLoop(n); },
    setLoop, play,
    setMusic(on) { if (on === st.music) return; st.music = on; if (on) { st.variantT = now(); setLoop(st.variant); } else setLoop(st.userLoop || 'idle'); },
    setMusicPaused(p) { if (!st.music) return; setLoop(p ? 'music_paused' : st.variant); },
    list: () => Object.keys(C), meta: (n) => C[n] || {},
  };
  window.NexEyes = api;
  addEventListener('mousemove', e => st.mouse = { x: e.clientX, y: e.clientY, t: now() });

  // ---------------- target computation
  function target(t) {
    if (st.pending && t >= st.pending.at) { startLoop(st.pending.to); st.pending = null; }
    if (st.music && C[st.loop].exit === 'headset_off' && st.loop !== 'music_paused' && t - st.variantT > 16) { let v; do v = MUSIC[(Math.random() * MUSIC.length) | 0]; while (v === st.variant); st.variant = v; st.variantT = t; setLoop(v); }
    const tg = Object.assign({}, NUM, { shape: 'rect' }); PROPS.forEach(p => tg[p] = 0);
    const add = (p, w) => { if (!p) return; for (const k in NUM) if (p[k] !== undefined) { if (k === 'lid' || k === 'lidL' || k === 'lidR' || k === 'lower') tg[k] = Math.max(tg[k], p[k] * w); else if (k === 'sx' || k === 'sy' || k === 'glow') tg[k] += (p[k] - 1) * w; else tg[k] += p[k] * w; } if (p.shape && w > .5) tg.shape = p.shape; PROPS.forEach(k => { if (p[k]) tg[k] = Math.max(tg[k], w); }); };
    const lt = t - st.loopT0, xf = Math.min(1, lt / .5);
    if (st.prev && xf < 1) add(C[st.prev].at(t - st.prevT0, st.ctx), 1 - xf);
    add(C[st.loop].at(lt, st.ctx), st.pending ? .3 * xf : xf);
    st.shots = st.shots.filter(s => { const lt2 = t - s.t0; if (lt2 < 0) return true; const c = C[s.n]; if (lt2 > c.dur) return false; const w = Math.min(1, lt2 / .1) * Math.min(1, (c.dur - lt2) / .25) * s.w; add(c.at(lt2, st.ctx), w); return true; });
    // micro-behaviour
    if (t - st.lastBlink > st.nextBlink && tg.lid < .5) { st.lastBlink = t; st.nextBlink = 2.5 + Math.random() * 4; play(Math.random() < .12 ? 'blink2' : 'blink'); }
    if (st.loop === 'idle' && !st.pending && t - st.lastFidget > st.nextFidget) { st.lastFidget = t; st.nextFidget = 6 + Math.random() * 8; play(FIDGETS[(Math.random() * FIDGETS.length) | 0]); }
    if (st.mouse && t - st.mouse.t < 5 && !st.music && st.loop === 'idle') { tg.x += (st.mouse.x - W / 2) / W * 18; tg.y += (st.mouse.y - H / 2) / H * 12; }
    return tg;
  }

  // ---------------- drawing helpers
  function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function eyeShape(w, h, r) {
    const hw = w / 2, hh = h / 2;
    const sw = { rect: 0, happy: 0, sad: 0, angry: 0, focus: 0, surprised: 0, closed: 0 };
    for (const s in shapeW) sw[s] = shapeW[s];
    // base rounded rect; expressions are drawn via lids + slight geometry blends
    const bulge = sw.surprised * .08;                  // rounder when surprised
    const squash = sw.focus * .22 + sw.closed * .9;    // flatter when focused
    const hh2 = hh * (1 - squash * .5 + bulge);
    ctx.beginPath();
    const rad = r + sw.surprised * hw * .6 + sw.happy * r * .4;
    // happy: bottom edge curves up; sad: top edge curves down (drawn as lids later)
    const upBottom = sw.happy * hh2 * .55;
    ctx.moveTo(-hw + rad, -hh2);
    ctx.arcTo(hw, -hh2, hw, hh2, rad);
    ctx.arcTo(hw, hh2, -hw, hh2, rad);
    if (upBottom > .5) { ctx.lineTo(hw - rad, hh2); ctx.quadraticCurveTo(0, hh2 - upBottom * 1.6, -hw + rad, hh2); }
    ctx.arcTo(-hw, hh2, -hw, -hh2, rad);
    ctx.arcTo(-hw, -hh2, hw, -hh2, rad);
    ctx.closePath();
    return hh2;
  }

  function drawEye(side, cx, cy) {
    const w = G.w * S * pose.sx, h = G.h * S * pose.sy;
    const lidTop = Math.min(1, pose.lid + (side < 0 ? pose.lidL : pose.lidR));
    ctx.save(); ctx.translate(cx + pose.x, cy + pose.y);
    ctx.shadowColor = `rgba(255,255,255,${.25 * pose.glow})`; ctx.shadowBlur = 40 * S * pose.glow;
    ctx.fillStyle = '#fff';
    const hh2 = eyeShape(w, h, G.r * S); ctx.fill();
    ctx.shadowBlur = 0;
    // lids (black) inside clip
    ctx.save(); eyeShape(w, h, G.r * S); ctx.clip(); ctx.fillStyle = '#000';
    const sad = shapeW.sad, angry = shapeW.angry;
    // top lid — straight, or slanted for sad/angry
    const inner = side < 0 ? 1 : -1;  // inner corner direction
    const slant = (sad * .55 - angry * .55) * h;   // sad: inner corner high -> outer low; angry: inner low
    const yTop = -hh2 + lidTop * h * 1.05;
    ctx.beginPath(); ctx.moveTo(-w, -h * 2); ctx.lineTo(w, -h * 2);
    ctx.lineTo(w, yTop + (inner > 0 ? slant : 0)); ctx.lineTo(-w, yTop + (inner < 0 ? slant : 0)); ctx.closePath(); ctx.fill();
    if (pose.lower > .001) ctx.fillRect(-w, hh2 - pose.lower * h * .9, w * 2, h * 2);
    ctx.restore(); ctx.restore();
  }

  // ---------------- props (white line art, alpha = propA)
  const P = {};
  const line = (lw) => { ctx.strokeStyle = '#fff'; ctx.lineWidth = lw * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  P.headset = (a, t, cx, cy) => {
    const span = (G.gap / 2 + G.w) * S + 34 * S, drop = (1 - a) * -120 * S;   // slides in from above
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy + drop);
    line(7); ctx.beginPath(); ctx.arc(0, 14 * S, span, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const sd of [-1, 1]) { rr(sd * span - 22 * S, -18 * S, 44 * S, 96 * S, 18 * S); ctx.fill(); ctx.fillStyle = '#000'; rr(sd * span - 12 * S, 2 * S, 24 * S, 56 * S, 10 * S); ctx.fill(); ctx.fillStyle = '#fff'; }
    ctx.restore();
  };
  P.dots = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff'; const x0 = cx + (G.gap / 2 + G.w) * S + 42 * S, y = cy - G.h * S * .6; for (let i = 0; i < 3; i++) { const p = Math.max(0, sin(t * 3.2 - i * .7)); ctx.globalAlpha = a * (.35 + p * .65); ctx.beginPath(); ctx.arc(x0 + i * 18 * S, y - p * 6 * S, 4 * S, 0, TAU); ctx.fill(); } ctx.restore(); };
  P.spinner = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; line(3); const x = cx + (G.gap / 2 + G.w) * S + 50 * S, y = cy - G.h * S * .55; ctx.beginPath(); ctx.arc(x, y, 12 * S, t * 5, t * 5 + Math.PI * 1.4); ctx.stroke(); ctx.restore(); };
  P.bars = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#fff'; const y = cy + G.h * S * .5 + 44 * S; for (let i = 0; i < 9; i++) { const h = (4 + abs(sin(t * 6 + i * 1.1) * sin(t * 2.3 + i)) * 22) * S; rr(cx - 56 * S + i * 14 * S, y - h, 6 * S, h, 3 * S); ctx.fill(); } ctx.restore(); };
  P.wave = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; line(2.5); for (const sd of [-1, 1]) { const x0 = cx + sd * ((G.gap / 2 + G.w) * S + 30 * S); for (let i = 0; i < 3; i++) { const h = (8 + i * 5) * S * (.6 + sin(t * 5 + i) * .4); ctx.globalAlpha = a * (.9 - i * .28); ctx.beginPath(); ctx.moveTo(x0 + sd * i * 11 * S, cy - h); ctx.lineTo(x0 + sd * i * 11 * S, cy + h); ctx.stroke(); } } ctx.restore(); };
  P.check = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; line(6); const y = cy - G.h * S * .5 - 56 * S, p = Math.min(1, t / .5); ctx.beginPath(); ctx.moveTo(cx - 22 * S, y); ctx.lineTo(cx - 22 * S + 18 * S * Math.min(1, p * 2), y + 18 * S * Math.min(1, p * 2)); if (p > .5) ctx.lineTo(cx - 4 * S + 30 * S * (p - .5) * 2, y + 18 * S - 40 * S * (p - .5) * 2); ctx.stroke(); ctx.restore(); };
  P.cross = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; line(6); const y = cy - G.h * S * .5 - 56 * S, r = 16 * S; ctx.beginPath(); ctx.moveTo(cx - r, y - r); ctx.lineTo(cx + r, y + r); ctx.moveTo(cx + r, y - r); ctx.lineTo(cx - r, y + r); ctx.stroke(); ctx.restore(); };
  P.bulb = (a, t, cx, cy) => { ctx.save(); ctx.globalAlpha = a; const y = cy - G.h * S * .5 - 70 * S; line(3); ctx.beginPath(); ctx.arc(cx, y, 16 * S, Math.PI * .8, Math.PI * 2.2); ctx.lineTo(cx + 8 * S, y + 22 * S); ctx.lineTo(cx - 8 * S, y + 22 * S); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - 7 * S, y + 30 * S); ctx.lineTo(cx + 7 * S, y + 30 * S); ctx.stroke(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 30 * S; ctx.fillStyle = `rgba(255,255,255,${.5 + sin(t * 6) * .3})`; ctx.beginPath(); ctx.arc(cx, y, 9 * S, 0, TAU); ctx.fill(); ctx.restore(); };
  P.note = (a, t, cx, cy) => { ctx.save(); ctx.fillStyle = '#fff'; ctx.font = `${26 * S}px serif`; ctx.textAlign = 'center'; for (let i = 0; i < 3; i++) { const p = (t * .3 + i * .33) % 1; const x = cx + (i % 2 ? 1 : -1) * ((G.gap / 2 + G.w) * S + 56 * S + sin(p * 6 + i) * 14 * S); ctx.globalAlpha = a * (1 - p) * .8; ctx.fillText(['♪', '♫', '♩'][i], x, cy + 20 * S - p * 150 * S); } ctx.restore(); };

  // ---------------- frame
  let last = now();
  function frame() {
    requestAnimationFrame(frame);
    const t = now(); const dt = Math.min(.04, t - last); last = t;
    const tg = target(t);
    for (const k in NUM) spring(k, tg[k], dt);
    for (const s of SHAPES) { const want = tg.shape === s ? 1 : 0; shapeW[s] += (want - shapeW[s]) * Math.min(1, dt * 9); }
    for (const p of PROPS) { const want = tg[p]; propA[p] += (want - propA[p]) * Math.min(1, dt * (want > propA[p] ? 6 : 4)); }
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2 + pose.px, cy = H / 2 - 16 * S + pose.py;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(pose.tilt); ctx.translate(-cx, -cy);
    if (propA.headset > .01) P.headset(propA.headset, t, cx, cy);
    const off = (G.gap / 2 + G.w / 2) * S;
    drawEye(-1, cx - off, cy); drawEye(1, cx + off, cy);
    for (const p of PROPS) if (p !== 'headset' && propA[p] > .01) P[p](propA[p], t, cx, cy);
    ctx.restore();
    st.ctx.beat = (t * 1.9) % 1;
  }
  frame();
})();
