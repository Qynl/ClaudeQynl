/* ============================================================
   NEX ANIMATION LIBRARY  v2
   ------------------------------------------------------------
   Each clip is  (t, ctx) => pose.   t = seconds since clip start.
   ctx = { beat 0..1, energy 0..1, prevProps: Set }

   Pose fields (all optional, blended over the neutral pose):
     lx ly rx ry        eye offsets (px)         lw lh rw rh   eye scale
     lr rr              eye rotation (rad)       lidT lidB     lids 0..1 (both eyes)
     lLidT rLidT        per-eye top lid          squint        0..1 both lids partial
     glow 0..2  hue °   bodyX bodyY bodyR (whole face)
     shape  'rect'|'happy'|'sad'|'angry'|'surprised'|'sleepy'|'heart'|'x'|'dot'|'wide'|'focus'|'star'
     props  ['headset', ...]   propAnim  number   (props fade/slide in & out automatically)
     loop true | duration seconds

   Clip metadata (A.name.meta):
     kind   'loop' | 'shot'
     enter  clip to play when this loop starts   (e.g. put headset on)
     exit   clip to play when this loop ends     (e.g. take headset off)
     family group; switching loops inside a family skips enter/exit (music_* → music_*)
     desc   human description (used in README + picker)
   ============================================================ */
const A = {};
const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
const clamp = (v, a, b) => max(a, min(b, v));
const ease = (x) => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutElastic = (x) => x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * sin((x * 10 - .75) * (TAU / 3)) + 1;
const pulse = (t, f = 1) => (sin(t * TAU * f) + 1) / 2;
const bounce = (x) => { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + .75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + .9375; return n1 * (x -= 2.625 / d1) * x + .984375; };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const bell = (t, a, b) => sin(seg(t, a, b) * Math.PI);           // 0→1→0 over [a,b]
const noise = (t, s = 1) => sin(t * 1.7 * s) * .5 + sin(t * 2.9 * s + 1.3) * .3 + sin(t * 4.3 * s + 2.1) * .2; // organic wobble
const def = (name, fn, meta) => { fn.meta = Object.assign({ kind: 'shot' }, meta || {}); A[name] = fn; };
const loop = (name, fn, meta) => def(name, (t, c) => Object.assign({ loop: true }, fn(t, c)), Object.assign({ kind: 'loop' }, meta || {}));

/* ==================== IDLE FAMILY ==================== */
loop('idle', (t) => ({ bodyY: sin(t * 1.1) * 3 + noise(t, .3) * 1.5, bodyR: noise(t, .25) * .012, lx: noise(t, .4) * 2, rx: noise(t, .4) * 2, glow: 1 + sin(t * 1.4) * .07 }), { family: 'idle', desc: 'Neutral breathing. Slow float, micro-drift, soft glow pulse.' });
loop('idle_look_around', (t) => { const p = (t % 6) / 6; const x = p < .3 ? -18 * easeOut(seg(p, 0, .12)) : p < .6 ? -18 + 36 * ease(seg(p, .35, .47)) : 18 - 18 * ease(seg(p, .7, .82)); return { lx: x, rx: x, ly: sin(t) * 3, ry: sin(t) * 3, bodyR: x * .002 }; }, { family: 'idle', desc: 'Glances left, holds, then right, then back to centre.' });
loop('idle_bored', (t) => ({ lidT: .35 + sin(t * .8) * .05, ly: 4, ry: 4, bodyY: 4 + sin(t * .7) * 2, lx: sin(t * .3) * 10, rx: sin(t * .3) * 10 }), { family: 'idle', desc: 'Heavy-lidded, eyes drift lazily side to side.' });
loop('idle_curious', (t) => ({ bodyR: sin(t * .9) * .08, lh: 1.08, rh: .94, ly: -3, ry: 2 }), { family: 'idle', desc: 'Head tilt with one eye slightly taller — “hm?”' });
loop('idle_wiggle', (t) => ({ lr: sin(t * 4) * .05, rr: -sin(t * 4) * .05, bodyY: abs(sin(t * 4)) * -6 }), { family: 'idle', desc: 'Playful counter-rotating wiggle with little hops.' });
loop('idle_breathe', (t) => ({ lw: 1 + sin(t * .9) * .03, lh: 1 + sin(t * .9) * .05, rw: 1 + sin(t * .9) * .03, rh: 1 + sin(t * .9) * .05 }), { family: 'idle', desc: 'Very slow scale breathing, nothing else.' });
loop('heartbeat', (t) => { const b = t % 1.1; const k = b < .12 ? sin(b / .12 * Math.PI) : b > .2 && b < .35 ? sin((b - .2) / .15 * Math.PI) * .6 : 0; return { lw: 1 + k * .08, rw: 1 + k * .08, lh: 1 + k * .08, rh: 1 + k * .08, glow: .8 + k * 1.2, lidT: .25 }; }, { family: 'idle', desc: 'Lub-dub double pump of scale and glow.' });

/* ==================== SLEEP FAMILY (enter: doze off, exit: wake_stretch) ==================== */
def('fall_asleep', (t) => { const p = ease(seg(t, 0, 1.6)); return { duration: 1.8, lidT: p * .92, bodyY: p * 10, ly: p * 6, ry: p * 6, glow: 1 - p * .5, shape: p > .8 ? 'sleepy' : 'rect' }; }, { desc: 'Lids slowly sink, eyes drift down, glow dims.' });
loop('sleep', (t) => ({ lidT: .92, shape: 'sleepy', bodyY: 10 + sin(t * .8) * 4, props: ['zzz'], propAnim: t, glow: .5 }), { family: 'sleep', enter: 'fall_asleep', exit: 'wake_stretch', desc: 'Asleep. Slow rise and fall, floating z’s.' });
loop('doze', (t) => { const d = pulse(t, .25); return { lidT: .5 + d * .4, bodyY: 6 + d * 8, bodyR: d * .06, glow: .7 }; }, { family: 'sleep', enter: 'fall_asleep', exit: 'wake_stretch', desc: 'Nodding off: head drops, jerks back, drops again.' });
def('wake_stretch', (t) => { const a = easeOut(seg(t, 0, .8)), b = bell(t, .8, 2), c = seg(t, 2, 2.5); return { duration: 2.8, lidT: (1 - a) * .95 + (c > 0 && c < 1 ? sin(c * Math.PI) : 0), lh: 1 + b * .45, rh: 1 + b * .45, lw: 1 - b * .18, rw: 1 - b * .18, bodyY: 10 * (1 - a) - b * 12, bodyR: t > 2.5 ? sin(t * 40) * .03 * (1 - seg(t, 2.5, 2.8)) : 0, glow: .3 + a * 1.1 }; }, { desc: 'Morning routine: lids open, tall stretch, shake-off, blink.' });
def('wake', (t) => { const p = easeOut(seg(t, 0, .9)); return { duration: 1.4, lidT: (1 - p) * .95, bodyY: (1 - p) * 10, glow: .3 + p * 1.2, lh: .6 + p * .4, rh: .6 + p * .4 }; }, { desc: 'Quick wake: lids open, eyes grow to full size.' });

/* ==================== VOICE ==================== */
loop('listen', (t) => ({ lw: 1.08, rw: 1.08, lh: 1.12, rh: 1.12, glow: 1.4 + sin(t * 6) * .2, bodyR: .06, ly: -4, ry: -4, props: ['wave'], propAnim: t }), { family: 'voice', desc: 'Eyes widen, lean in, sound waves pulse either side.' });
loop('listen_lean', (t) => ({ bodyR: .12, bodyX: 8, lh: 1.15, rh: 1.05, glow: 1.5, props: ['wave'], propAnim: t }), { family: 'voice', desc: 'Stronger lean toward the user, one eye taller.' });
loop('speak', (t) => ({ lh: 1 + sin(t * 9) * .06, rh: 1 + sin(t * 9) * .06, bodyY: sin(t * 4.5) * 3 + noise(t, 2) * 1.5, glow: 1.3 + sin(t * 9) * .15, bodyR: noise(t, 1.2) * .02 }), { family: 'voice', desc: 'Syllable-rate height flicker with gentle nodding.' });
loop('speak_excited', (t) => ({ lh: 1.1 + sin(t * 12) * .1, rh: 1.1 + sin(t * 12) * .1, bodyY: sin(t * 6) * 5, bodyR: sin(t * 3) * .05, glow: 1.6, shape: 'happy' }), { family: 'voice', desc: 'Happy shape, bigger bounce, brighter glow.' });
loop('speak_calm', (t) => ({ lh: 1 + sin(t * 5) * .03, rh: 1 + sin(t * 5) * .03, lidT: .12, bodyY: sin(t * 2) * 2 }), { family: 'voice', desc: 'Soft-spoken: relaxed lids, minimal motion.' });
def('wake_word', (t) => { const p = seg(t, 0, .3); return { duration: .8, lw: 1 + easeOutBack(p) * .2, rw: 1 + easeOutBack(p) * .2, lh: 1 + easeOutBack(p) * .25, rh: 1 + easeOutBack(p) * .25, bodyY: -12 * easeOutBack(p) * (1 - seg(t, .4, .8)), glow: 1 + p, ly: -6, ry: -6 }; }, { desc: 'Heard “Nex”: snap to attention, pop bigger.' });

/* ==================== THINKING ==================== */
loop('think', (t) => ({ lx: 14 + noise(t, .5) * 2, rx: 14 + noise(t, .5) * 2, ly: -16, ry: -16, lidT: .25, lr: -.05, rr: -.05, bodyR: -.05, props: ['dots'], propAnim: t, glow: .9 }), { family: 'think', desc: 'Eyes up-right, lids relaxed, three thinking dots.' });
loop('think_hard', (t) => ({ lx: 12 + sin(t * 2) * 6, rx: 12 + sin(t * 2) * 6, ly: -14, ry: -14, squint: .35, bodyR: -.08 + sin(t * .7) * .04, props: ['dots', 'gear'], propAnim: t }), { family: 'think', desc: 'Squinted, eyes rocking, a gear turns.' });
loop('idea_think', (t) => ({ lx: -10, rx: -10, ly: -18, ry: -18, lidT: .2, bodyR: .06, props: ['dots'], propAnim: t }), { family: 'think', desc: 'Up-left daydream — the idle idea scout.' });
def('hmm', (t) => ({ duration: 2, lidT: .4, lx: -12, rx: -12, ly: -8, ry: -8, bodyR: .07, props: ['dots'], propAnim: t }), { desc: 'Short pensive “hmm” with tilt.' });

/* ==================== PLANNING (enter: unroll clipboard, exit: put it away) ==================== */
def('plan_start', (t) => { const p = easeOutBack(seg(t, 0, .6)); return { duration: .8, ly: 6 * p, ry: 6 * p, props: ['clipboard'], propAnim: p, squint: .15 * p }; }, { desc: 'Clipboard slides up from below.' });
def('plan_end', (t) => { const p = 1 - easeIn(seg(t, 0, .5)); return { duration: .6, ly: 6 * p, ry: 6 * p, props: ['clipboard'], propAnim: p }; }, { desc: 'Clipboard drops away, eyes come back up.' });
loop('plan', (t) => ({ ly: 6, ry: 6, lx: sin(t * 2.5) * 14, rx: sin(t * 2.5) * 14, squint: .15, props: ['clipboard'], propAnim: 1 + t }), { family: 'plan', enter: 'plan_start', exit: 'plan_end', desc: 'Reads down a checklist, boxes tick over time.' });
loop('plan_subagents', (t) => ({ ly: 4, ry: 4, lx: sin(t * 1.4) * 10, rx: sin(t * 1.4) * 10, squint: .1, props: ['clipboard', 'agents'], propAnim: 1 + t, glow: 1.1 }), { family: 'plan', enter: 'plan_start', exit: 'plan_end', desc: 'Design/Tech/Art/QA agent orbs light up in turn while the clipboard fills.' });
loop('compile', (t) => { const p = (t % 3) / 3; return { squint: .2 + p * .4, lx: sin(t * 3) * 3, rx: sin(t * 3) * 3, bodyX: p > .92 ? sin(t * 90) * 3 : 0, props: ['progress'], propAnim: p, glow: 1 + p * .6 }; }, { family: 'plan', desc: 'Progress bar fills, squint deepens, tiny shake at 100%.' });

/* ==================== WORKING (enter: crack knuckles, exit: put tools down) ==================== */
def('work_start', (t) => { const p = seg(t, 0, .7); return { duration: .9, bodyY: -8 * bell(t, 0, .5), lw: 1 + bell(t, 0, .5) * .08, rw: 1 + bell(t, 0, .5) * .08, squint: .25 * easeOut(p), ly: 8 * easeOut(p), ry: 8 * easeOut(p), bodyR: sin(t * 25) * .03 * bell(t, .2, .7) }; }, { desc: 'Roll shoulders, drop the gaze to the desk.' });
def('work_end', (t) => { const p = easeOut(seg(t, 0, .6)); return { duration: .9, ly: 8 * (1 - p), ry: 8 * (1 - p), squint: .25 * (1 - p), bodyY: -6 * bell(t, .3, .9), lidT: bell(t, .55, .8) }; }, { desc: 'Tools go down, eyes lift, satisfied blink.' });
loop('work', (t) => ({ ly: 8, ry: 8, squint: .25, lx: sin(t * 6) * 5, rx: sin(t * 6) * 5, bodyY: abs(sin(t * 6)) * 2, props: ['gear'], propAnim: t, shape: 'focus' }), { family: 'work', enter: 'work_start', exit: 'work_end', desc: 'Focused build loop with a turning gear.' });
loop('write', (t) => ({ ly: 10, ry: 10, lx: ((t * 60) % 40) - 20, rx: ((t * 60) % 40) - 20, squint: .2, props: ['pencil'], propAnim: t, shape: 'focus' }), { family: 'work', enter: 'work_start', exit: 'work_end', desc: 'Eyes track a pencil writing line after line.' });
loop('typing', (t) => { const line = Math.floor(t * 1.4) % 4; return { ly: 6 + line * 3, ry: 6 + line * 3, lx: ((t * 90) % 46) - 23, rx: ((t * 90) % 46) - 23, squint: .3, bodyY: abs(sin(t * 28)) * -1.5, props: ['keyboard'], propAnim: t, shape: 'focus', glow: 1.15 }; }, { family: 'work', enter: 'work_start', exit: 'work_end', desc: 'Rapid code typing: line-by-line scan, caret tick, keys light up.' });
loop('read', (t) => { const p = (t % 2) / 2; return { ly: 8, ry: 8, lx: -18 + 36 * p, rx: -18 + 36 * p, squint: .15, props: ['book'], propAnim: t }; }, { family: 'work', enter: 'work_start', exit: 'work_end', desc: 'Reads lines across an open book.' });
loop('scan', (t) => { const p = (t % 2.4) / 2.4; const y = -1 + p * 2; return { ly: y * 18, ry: y * 18, lidT: .1, props: ['laser'], propAnim: p, glow: 1.2 + (1 - abs(y)) * .5, hue: 20 }; }, { family: 'work', desc: 'Inspect mode: a laser line sweeps, eyes follow it.' });
loop('search', (t) => ({ lx: sin(t * 3) * 18, rx: sin(t * 3) * 18, ly: cos(t * 2) * 10, ry: cos(t * 2) * 10, lw: .95, rw: 1.15, rh: 1.15, props: ['magnifier'], propAnim: t }), { family: 'work', desc: 'Magnifier roams, one eye enlarged behind it.' });
loop('fix', (t) => ({ squint: .3, bodyR: sin(t * 8) * .04, bodyY: abs(sin(t * 8)) * -3, props: ['wrench'], propAnim: t, shape: 'focus' }), { family: 'work', enter: 'work_start', exit: 'work_end', desc: 'Wrench cranks, small determined jolts.' });
def('tool_call', (t) => ({ duration: .6, ly: 8, ry: 8, squint: .3, glow: 1 + bell(t, 0, .6) * .8 }), { desc: 'Flash of glow as a tool is invoked.' });
def('tool_result', (t) => ({ duration: .5, ly: -4, ry: -4, glow: 1 + bell(t, 0, .5) * .5 }), { desc: 'Small upward glance as the result lands.' });

/* ==================== REVIEW COMMITTEE ==================== */
loop('review_pos', (t) => ({ shape: 'happy', bodyR: .05, bodyY: sin(t * 2) * 3, props: ['thumbup'], propAnim: 1 + t, hue: 60, glow: 1.3 }), { family: 'review', desc: 'Optimist: warm hue, happy eyes, thumbs up.' });
loop('review_neg', (t) => ({ shape: 'angry', squint: .3, bodyR: -.05, lx: -6, rx: -6, props: ['thumbdown'], propAnim: t, hue: -40 }), { family: 'review', desc: 'Pessimist: cold hue, narrowed eyes, thumbs down.' });
loop('judge', (t) => ({ lidT: .2, bodyY: -2, props: ['scale'], propAnim: t, ly: 4, ry: 4, glow: 1.1 }), { family: 'review', desc: 'Judge: level gaze, balance scale tips back and forth.' });
def('approve', (t) => ({ duration: 1.5, shape: 'happy', bodyY: sin(t * 8) * 8 * (1 - t / 1.5), props: ['thumbup'], propAnim: easeOutBack(seg(t, 0, .3)) }), { desc: 'Verdict pass: nodding bounce.' });
def('disapprove', (t) => ({ duration: 1.5, shape: 'angry', bodyX: sin(t * 12) * 8 * (1 - t / 1.5), props: ['thumbdown'], propAnim: t }), { desc: 'Verdict redo: head shake.' });

/* ==================== MUSIC FAMILY (enter: headset on, exit: headset off) ==================== */
def('headset_on', (t) => { const p = easeOutBack(seg(t, .1, .8)); return { duration: 1.1, bodyY: -6 * bell(t, .5, 1.1), lh: 1 + bell(t, .6, 1.1) * .2, rh: 1 + bell(t, .6, 1.1) * .2, props: ['headset'], propAnim: p, shape: t > .8 ? 'happy' : 'rect', glow: 1 + p * .4, lidT: bell(t, .75, .95) * .6 }; }, { desc: 'Headset drops down from above, lands with a small bounce, happy blink.' });
def('headset_off', (t) => { const p = 1 - easeIn(seg(t, .15, .9)); return { duration: 1.2, props: ['headset'], propAnim: p, bodyY: 4 * seg(t, 0, .4), lidT: bell(t, 0, .35) * .5, shape: t < .3 ? 'happy' : 'rect', bodyR: sin(t * 20) * .02 * bell(t, .9, 1.2) }; }, { desc: 'Takes the headset off — lifts up and away, shakes hair out, settles.' });
const HS = { family: 'music', enter: 'headset_on', exit: 'headset_off' };
loop('music_vibe', (t, c) => { const b = c.beat || (t % .5) / .5; const k = 1 - b; return { bodyX: sin(t * TAU * .95) * 26, bodyR: sin(t * TAU * .95) * .16, bodyY: -abs(sin(t * TAU * 1.9)) * 8, lh: 1 + k * .15, rh: 1 + k * .15, shape: 'happy', props: ['headset', 'notes'], propAnim: 1 + t, glow: 1.3 + k * .4 }; }, Object.assign({ desc: 'Default vibe: sways side to side, bounces on the beat.' }, HS));
loop('music_headbang', (t) => ({ bodyY: abs(sin(t * TAU * 1.9)) * -22, bodyR: sin(t * TAU * 1.9) * .06, squint: .5, props: ['headset', 'notes'], propAnim: 1 + t, shape: 'focus', glow: 1.5 }), Object.assign({ desc: 'Hard nods, eyes squeezed.' }, HS));
loop('music_sway', (t) => ({ bodyX: sin(t * TAU * .45) * 34, bodyR: sin(t * TAU * .45) * .22, lidT: .35, shape: 'happy', props: ['headset', 'notes'], propAnim: 1 + t }), Object.assign({ desc: 'Slow wide sway, dreamy lids.' }, HS));
loop('music_bounce', (t) => { const k = abs(sin(t * TAU * 1.9)); return { bodyY: -k * 16, lw: 1 + k * .1, rw: 1 + k * .1, lh: 1 - k * .1, rh: 1 - k * .1, shape: 'happy', props: ['headset', 'notes'], propAnim: 1 + t }; }, Object.assign({ desc: 'Squash-and-stretch hop every beat.' }, HS));
loop('music_eyes_closed', (t) => ({ lidT: .95, shape: 'happy', bodyX: sin(t * TAU * .5) * 20, bodyR: sin(t * TAU * .5) * .15, props: ['headset', 'notes'], propAnim: 1 + t, glow: 1.1 }), Object.assign({ desc: 'Eyes closed, lost in it.' }, HS));
loop('music_shuffle', (t) => ({ bodyX: ((t * 2) % 2 < 1 ? 1 : -1) * 20 * abs(sin(t * TAU)), bodyY: -abs(sin(t * TAU * 2)) * 6, lr: sin(t * TAU) * .1, rr: sin(t * TAU) * .1, props: ['headset', 'notes'], propAnim: 1 + t, shape: 'happy' }), Object.assign({ desc: 'Side-step shuffle, eyes roll with the steps.' }, HS));
loop('music_love', (t) => ({ shape: 'heart', bodyY: sin(t * 3) * 4, props: ['headset', 'heart'], propAnim: 1 + t, hue: -30, glow: 1.5 }), Object.assign({ desc: 'Heart eyes — this song is a favourite.' }, HS));
loop('music_dj', (t, c) => { const b = c.beat || (t % .5) / .5; return { bodyR: -.18 + sin(t * TAU * .95) * .06, bodyX: -12, bodyY: -abs(sin(t * TAU * 1.9)) * 6, lLidT: .35, rLidT: .1, lx: sin(t * TAU * 3.8) * 4 * (b < .3 ? 1 : 0), rx: sin(t * TAU * 3.8) * 4 * (b < .3 ? 1 : 0), shape: 'focus', props: ['headset', 'hand_headset', 'notes', 'equalizer'], propAnim: 1 + t, glow: 1.4 + (1 - b) * .5 }; }, Object.assign({ desc: 'DJ: hand on the cup, head tilted, scratch wobble, equalizer.' }, HS));
def('music_drop', (t) => { const p = seg(t, 0, .35); return { duration: 1.2, bodyY: (1 - bounce(p)) * -60, lw: 1.2, rw: 1.2, lh: .7 + bounce(p) * .5, rh: .7 + bounce(p) * .5, glow: 2.2, hue: t * 300, props: ['headset', 'sparks'], propAnim: 1, shape: 'surprised' }; }, { desc: 'Beat drop: slam down, rainbow flash, sparks.' });
def('music_next', (t) => { const p = ease(seg(t, 0, .4)); return { duration: .5, bodyX: sin(p * Math.PI) * 40, lx: 20 * (1 - p), rx: 20 * (1 - p), props: ['headset'], propAnim: 1 }; }, { desc: 'Skip: quick swing to the right.' });
def('music_prev', (t) => { const p = ease(seg(t, 0, .4)); return { duration: .5, bodyX: -sin(p * Math.PI) * 40, lx: -20 * (1 - p), rx: -20 * (1 - p), props: ['headset'], propAnim: 1 }; }, { desc: 'Previous: quick swing to the left.' });
def('music_volume_up', (t) => ({ duration: .6, lw: 1 + sin(t * 10) * .1, rw: 1 + sin(t * 10) * .1, props: ['headset', 'vol_up'], propAnim: t, glow: 1.8 }), { desc: 'Volume up: eyes widen, speaker icon rises.' });
def('music_volume_down', (t) => ({ duration: .6, lw: 1 - abs(sin(t * 10)) * .1, rw: 1 - abs(sin(t * 10)) * .1, props: ['headset', 'vol_down'], propAnim: t, glow: .7 }), { desc: 'Volume down: eyes narrow, speaker icon sinks.' });
loop('music_paused', (t) => ({ lidT: .3, bodyY: 4 + sin(t) * 2, props: ['headset'], propAnim: 1, shape: 'rect' }), Object.assign({ desc: 'Paused but still wearing the headset, waiting.' }, HS));
loop('whistle', (t) => ({ lidT: .3, lx: 16, rx: 16, ly: -14, ry: -14, bodyR: sin(t * 2) * .05, props: ['notes'], propAnim: t }), { family: 'idle', desc: 'Innocent whistling, eyes up and away.' });

/* ==================== STATES ==================== */
loop('error', (t) => ({ shape: 'x', bodyX: sin(t * 40) * (t < .5 ? 6 : 1), hue: -60, glow: 1.4, props: ['exclaim'], propAnim: t }), { family: 'state', desc: 'X eyes, red tint, brief shake, exclamation.' });
loop('confused', (t) => ({ lh: 1.1, rh: .85, ry: 4, bodyR: .1, lx: sin(t * 2) * 4, rx: sin(t * 2) * 4, props: ['question'], propAnim: t }), { family: 'state', desc: 'Uneven eyes, tilt, floating question mark.' });
loop('waiting_consent', (t) => ({ lw: 1.1, rw: 1.1, lh: 1.15, rh: 1.15, glow: 1.2 + pulse(t, 1.5) * .3, props: ['question'], propAnim: t, bodyY: sin(t * 2) * 4 }), { family: 'state', desc: 'Big hopeful eyes, waiting for a yes/no.' });
loop('locked', (t) => ({ shape: 'focus', squint: .4, props: ['shield'], propAnim: 1, hue: 30, glow: 1.2 }), { family: 'state', desc: 'Shield up, guarded look.' });
loop('offline', (t) => ({ lidT: .7, glow: .3, hue: -120, bodyY: 8, props: ['plug'], propAnim: t }), { family: 'state', desc: 'Dim, half-closed, unplugged.' });
loop('loading', (t) => ({ lidT: .3, props: ['clock'], propAnim: t, lx: sin(t * 3) * 6, rx: sin(t * 3) * 6 }), { family: 'state', desc: 'Watching a clock tick.' });
loop('gamepad', (t) => ({ shape: 'focus', squint: .2, props: ['gamepad'], propAnim: t, bodyR: sin(t * 5) * .04, lx: sin(t * 7) * 6, rx: sin(t * 7) * 6 }), { family: 'state', desc: 'Watching a playtest: gamepad, darting eyes.' });

/* ==================== BLINKS & GLANCES ==================== */
def('blink', (t) => { const p = t / .16; const c = p < .5 ? ease(p * 2) : ease(2 - p * 2); return { duration: .16, lidT: c, lidB: c * .4 }; }, { desc: 'Standard blink.' });
def('double_blink', (t) => { const f = (x) => { const p = x / .14; if (p < 0 || p > 1) return 0; return p < .5 ? ease(p * 2) : ease(2 - p * 2); }; const c = f(t) + f(t - .2); return { duration: .36, lidT: clamp(c, 0, 1), lidB: clamp(c, 0, 1) * .4 }; }, { desc: 'Two quick blinks.' });
def('slow_blink', (t) => { const p = t / .7; const c = p < .5 ? ease(p * 2) : ease(2 - p * 2); return { duration: .7, lidT: c, lidB: c * .3, glow: 1 - c * .3 }; }, { desc: 'Slow contented blink.' });
def('wink', (t) => { const p = t / .5; const c = p < .4 ? ease(p / .4) : ease((1 - p) / .6); return { duration: .5, rLidT: c, shape: 'happy', bodyR: -.04 * c }; }, { desc: 'Right-eye wink.' });
def('wink_left', (t) => { const p = t / .5; const c = p < .4 ? ease(p / .4) : ease((1 - p) / .6); return { duration: .5, lLidT: c, shape: 'happy', bodyR: .04 * c }; }, { desc: 'Left-eye wink.' });
def('look_left', (t) => { const p = easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, lx: -22 * p, rx: -22 * p }; }, { desc: 'Glance left and back.' });
def('look_right', (t) => { const p = easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, lx: 22 * p, rx: 22 * p }; }, { desc: 'Glance right and back.' });
def('look_up', (t) => { const p = easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, ly: -20 * p, ry: -20 * p }; }, { desc: 'Glance up and back.' });
def('look_down', (t) => { const p = easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, ly: 20 * p, ry: 20 * p, lidT: .25 * p }; }, { desc: 'Glance down, lids follow.' });
def('roll_eyes', (t) => { const p = seg(t, 0, .9); const a = p * Math.PI; return { duration: 1.2, lx: cos(a) * -16, rx: cos(a) * -16, ly: -sin(a) * 16, ry: -sin(a) * 16, lidT: .3 * p }; }, { desc: 'Eye-roll arc, lids settle half-way.' });
def('side_eye', (t) => { const p = easeOut(seg(t, 0, .35)) * (1 - ease(seg(t, 1.6, 2.1))); return { duration: 2.1, lx: 24 * p, rx: 24 * p, lLidT: .45 * p, rLidT: .2 * p, bodyR: -.04 * p }; }, { desc: 'Suspicious side-eye with one lid half-down.' });
def('squint_focus', (t) => ({ duration: 1.5, squint: .5, lw: 1.05, rw: 1.05, shape: 'focus' }), { desc: 'Narrowed, focused stare.' });
def('zoom_in', (t) => { const p = ease(seg(t, 0, .8)); return { duration: 1.6, lw: 1 + p * .3, rw: 1 + p * .3, lh: 1 + p * .3, rh: 1 + p * .3, squint: p * .3, glow: 1 + p * .5 }; }, { desc: 'Leans in — eyes grow and narrow.' });
def('tilt_left', (t) => ({ duration: 1.5, bodyR: -.14 * easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, 1, 1.5))) }), { desc: 'Head tilt left.' });
def('tilt_right', (t) => ({ duration: 1.5, bodyR: .14 * easeOut(seg(t, 0, .3)) * (1 - ease(seg(t, 1, 1.5))) }), { desc: 'Head tilt right.' });

/* ==================== EMOTIONS ==================== */
def('greet', (t) => ({ duration: 1.6, shape: 'happy', bodyR: sin(t * 8) * .12 * (1 - t / 1.6), bodyY: -6, glow: 1.4, props: ['wave_hand'], propAnim: t }), { desc: 'Hello wave.' });
def('nod', (t) => ({ duration: .9, bodyY: sin(t * TAU * 2.2) * 14 * (1 - t / .9), ly: sin(t * TAU * 2.2) * 6, ry: sin(t * TAU * 2.2) * 6 }), { desc: 'Yes nod.' });
def('shake_head', (t) => ({ duration: .9, bodyX: sin(t * TAU * 3) * 18 * (1 - t / .9), lx: -sin(t * TAU * 3) * 6, rx: -sin(t * TAU * 3) * 6, shape: 'sad' }), { desc: 'No shake.' });
def('happy', (t) => ({ duration: 2, shape: 'happy', bodyY: -abs(sin(t * 6)) * 8, glow: 1.5 }), { desc: 'Happy hops.' });
def('laugh', (t) => ({ duration: 1.8, shape: 'happy', bodyY: sin(t * 22) * 5, bodyR: sin(t * 11) * .03, lh: .8, rh: .8, glow: 1.6 }), { desc: 'Laughing shake.' });
def('giggle', (t) => ({ duration: 1.2, shape: 'happy', lidT: .5, bodyY: sin(t * 30) * 3, bodyX: sin(t * 15) * 2 }), { desc: 'Suppressed giggle.' });
def('sad', (t) => ({ duration: 2.5, shape: 'sad', ly: 6, ry: 6, bodyY: 8, lidT: .3, glow: .6, hue: -40 }), { desc: 'Droopy sad eyes.' });
def('cry', (t) => ({ duration: 3, shape: 'sad', lidT: .4, bodyY: 8 + sin(t * 12) * 2, props: ['tears'], propAnim: t, hue: -60, glow: .7 }), { desc: 'Tears streaming.' });
def('angry', (t) => ({ duration: 2, shape: 'angry', squint: .35, bodyX: sin(t * 50) * 2, hue: -90, glow: 1.6 }), { desc: 'Angry slant, trembling.' });
def('annoyed', (t) => ({ duration: 2, shape: 'angry', lidT: .45, lx: 16, rx: 16, bodyR: -.04 }), { desc: 'Half-lidded, looking away.' });
def('surprised', (t) => { const p = easeOutBack(seg(t, 0, .25)); return { duration: 1.5, shape: 'surprised', lw: 1 + p * .25, rw: 1 + p * .25, lh: 1 + p * .35, rh: 1 + p * .35, bodyY: -10 * p, glow: 1.7, props: ['exclaim'], propAnim: t }; }, { desc: 'Round wide eyes, pop up.' });
def('shocked', (t) => ({ duration: 1.8, shape: 'dot', lw: .5, rw: .5, lh: .5, rh: .5, bodyX: sin(t * 40) * 3, glow: 2, props: ['sparks'], propAnim: t }), { desc: 'Tiny dot pupils, trembling.' });
def('scared', (t) => ({ duration: 1.8, shape: 'wide', lh: 1.3, rh: 1.3, bodyX: sin(t * 35) * 4, bodyY: 6, glow: 1.2, hue: 40 }), { desc: 'Tall scared eyes, shivering.' });
def('love', (t) => ({ duration: 2.5, shape: 'heart', bodyY: sin(t * 4) * 5, hue: -30, glow: 1.6, props: ['heart'], propAnim: t }), { desc: 'Heart eyes with floating hearts.' });
def('proud', (t) => ({ duration: 2, shape: 'happy', lidT: .35, bodyY: -6, bodyR: .05, glow: 1.5, props: ['sparks'], propAnim: t }), { desc: 'Chest-out proud, sparkles.' });
def('smug', (t) => ({ duration: 2, lidT: .5, shape: 'happy', lx: 12, rx: 12, bodyR: -.06 }), { desc: 'Smug half-lids.' });
def('shy', (t) => ({ duration: 2.2, ly: 10, ry: 10, lx: -14, rx: -14, lidT: .3, bodyR: .08, hue: -20, glow: .9 }), { desc: 'Looks down and away, pinkish.' });
def('sigh', (t) => { const p = t / 2; return { duration: 2, lidT: p < .5 ? p * 1.4 : (1 - p) * 1.4, bodyY: p < .5 ? -8 * p * 2 : 12 * (1 - p) * 2 }; }, { desc: 'Inhale up, exhale down.' });
def('yawn', (t) => { const p = bell(t, 0, 2); return { duration: 2.2, lidT: p * .8, lh: 1 + p * .3, rh: 1 + p * .3, lw: 1 - p * .3, rw: 1 - p * .3, bodyY: -p * 6 }; }, { desc: 'Long yawn stretch.' });
def('facepalm', (t) => { const p = ease(seg(t, 0, .4)); return { duration: 2.4, lidT: .85 * p, ly: 14 * p, ry: 14 * p, bodyY: 10 * p, bodyR: sin(t * 3) * .05 * p, props: ['hand_cover'], propAnim: p, glow: .7 }; }, { desc: 'Hand over eye, slow shake.' });
def('rain_cloud', (t) => ({ duration: 3.5, shape: 'sad', bodyY: 10, ly: 4, ry: 4, lidT: .3, props: ['cloud'], propAnim: t, hue: -70, glow: .6 }), { desc: 'Sulks under a raining cloud.' });
def('dizzy', (t) => ({ duration: 2.5, lx: cos(t * 8) * 14, ly: sin(t * 8) * 14, rx: cos(t * 8 + Math.PI) * 14, ry: sin(t * 8 + Math.PI) * 14, bodyR: sin(t * 3) * .1, props: ['stars_orbit'], propAnim: t }), { desc: 'Eyes spiral, stars orbit.' });
def('shiver', (t) => ({ duration: 1.2, bodyX: sin(t * 60) * 3, bodyY: cos(t * 45) * 2, lidT: .2, hue: 60 }), { desc: 'Cold shiver.' });
def('bow', (t) => { const p = bell(t, 0, 1.5); return { duration: 1.5, bodyY: p * 30, ly: p * 10, ry: p * 10, lidT: p * .5, shape: 'happy' }; }, { desc: 'Polite bow.' });

/* ==================== IDEAS & RESULTS ==================== */
def('idea', (t) => { const p = easeOutBack(seg(t, 0, .3)); return { duration: 2.4, shape: 'surprised', ly: -8, ry: -8, lh: 1 + p * .2, rh: 1 + p * .2, bodyY: -8 * p, props: ['bulb'], propAnim: t, glow: 1.2 + p, hue: 30 }; }, { desc: 'Lightbulb pops on.' });
def('eureka', (t) => ({ duration: 2, shape: 'star', bodyY: -abs(sin(t * 8)) * 14, glow: 2, hue: 50, props: ['bulb', 'sparks'], propAnim: t }), { desc: 'Star eyes, bulb and sparks.' });
def('success', (t) => { const p = easeOutBack(seg(t, .1, .5)); return { duration: 1.8, shape: 'happy', bodyY: -8 * p, props: ['check'], propAnim: p, glow: 1.4, hue: 70 }; }, { desc: 'Green check draws in.' });
def('fail', (t) => { const p = seg(t, 0, .4); return { duration: 2, shape: 'sad', bodyY: 12 * ease(p), lidT: .35, props: ['cross'], propAnim: ease(p), hue: -60 }; }, { desc: 'Red cross, eyes sink.' });
def('celebrate', (t) => ({ duration: 4, shape: 'happy', bodyY: -abs(sin(t * 7)) * 22, bodyR: sin(t * 7) * .1, glow: 1.6 + pulse(t, 4) * .6, hue: (t * 120) % 360, props: ['confetti', 'sparks'], propAnim: t }), { desc: 'Confetti party, rainbow hue.' });
def('victory_spin', (t) => { const p = ease(seg(t, .1, .9)); const st = sin(p * Math.PI); return { duration: 2.2, bodyR: p * TAU, bodyY: -st * 50, lw: 1 - st * .2, rw: 1 - st * .2, lh: 1 + st * .3, rh: 1 + st * .3, shape: t > .9 ? 'happy' : 'rect', props: t > 1 ? ['sparks'] : [], propAnim: t, glow: 1.6, hue: p * 120 }; }, { desc: '360° spin with squash & stretch, proud landing.' });
def('bug_found', (t) => ({ duration: 2.2, shape: 'surprised', lw: 1.1, rw: 1.1, lx: sin(t * 20) * 4, rx: sin(t * 20) * 4, props: ['bug', 'exclaim'], propAnim: t, hue: -30 }), { desc: 'Spots a bug — startled.' });
def('bug_fixed', (t) => ({ duration: 2, shape: 'happy', props: ['bug', 'check'], propAnim: t, glow: 1.5, hue: 80 }), { desc: 'Bug squashed, check mark.' });
def('thumbs_up', (t) => ({ duration: 1.4, shape: 'happy', props: ['thumbup'], propAnim: easeOutBack(seg(t, 0, .3)), bodyY: -4 }), { desc: 'Thumbs up.' });
def('ok_sign', (t) => ({ duration: 1.4, shape: 'happy', props: ['check'], propAnim: easeOutBack(seg(t, 0, .3)), glow: 1.4 }), { desc: 'Quick OK check.' });
def('remember', (t) => ({ duration: 2, ly: -10, ry: -10, lidT: .2, props: ['brain'], propAnim: t, glow: 1.3, hue: 80 }), { desc: 'Stores a memory — brain glows.' });
def('forget', (t) => ({ duration: 1.8, lidT: .3, props: ['brain', 'cross'], propAnim: t, hue: -40 }), { desc: 'Deletes a memory.' });
def('compact_memory', (t) => ({ duration: 2, squint: .3, props: ['brain', 'gear'], propAnim: t, lx: sin(t * 8) * 3, rx: sin(t * 8) * 3 }), { desc: 'Compacting memory — brain + gear.' });
def('shield_block', (t) => { const p = easeOutBack(seg(t, 0, .3)); return { duration: 1.8, shape: 'focus', squint: .5, props: ['shield'], propAnim: p, hue: 40, glow: 1.6, bodyX: sin(t * 30) * 2 * (1 - t / 1.8) }; }, { desc: 'Safety layer blocked something.' });
def('connected', (t) => ({ duration: 2, shape: 'happy', props: ['plug', 'check'], propAnim: t, glow: 1.5, hue: 80 }), { desc: 'Engine connected.' });
def('disconnected', (t) => ({ duration: 2, shape: 'sad', props: ['plug', 'cross'], propAnim: t, hue: -80, glow: .7 }), { desc: 'Engine lost.' });
def('playtest_ask', (t) => ({ duration: 3, shape: 'happy', lh: 1.1, rh: 1.1, props: ['gamepad', 'question'], propAnim: t, bodyY: sin(t * 3) * 4, glow: 1.3 }), { desc: 'Asks permission to playtest.' });
def('alert', (t) => ({ duration: 1.5, shape: 'wide', lh: 1.25, rh: 1.25, glow: 1.5 + pulse(t, 4) * .6, hue: -30, props: ['exclaim'], propAnim: t }), { desc: 'Attention flash.' });
def('countdown', (t) => ({ duration: 3, lw: 1 + (t % 1) * .1, rw: 1 + (t % 1) * .1, glow: 2 - (t % 1), props: ['clock'], propAnim: t }), { desc: 'Three-second pulse countdown.' });
def('mode_plan', (t) => { const p = easeOutBack(seg(t, 0, .5)); return { duration: 1.4, ly: 4 * p, ry: 4 * p, lidT: .15 * p, props: ['clipboard'], propAnim: p, glow: 1.2, hue: 40 * p }; }, { desc: 'Switched to Plan mode: clipboard peeks up.' });
def('mode_build', (t) => { const p = easeOutBack(seg(t, 0, .5)); return { duration: 1.4, squint: .25 * p, bodyY: -6 * bell(t, 0, .6), props: ['wrench'], propAnim: p, glow: 1.3, shape: 'focus' }; }, { desc: 'Switched to Build mode: wrench spin, focused eyes.' });

/* ==================== MOVEMENT / FX ==================== */
def('glitch', (t) => ({ duration: .7, bodyX: (Math.random() - .5) * 30, lw: .8 + Math.random() * .5, rh: .8 + Math.random() * .5, hue: Math.random() * 360, glow: 2 }), { desc: 'Digital glitch.' });
def('electric', (t) => ({ duration: 1, bodyX: (Math.random() - .5) * 8, glow: 2 + Math.random(), hue: 60, props: ['sparks'], propAnim: t, shape: 'wide' }), { desc: 'Zapped.' });
def('bounce_in', (t) => { const p = bounce(seg(t, 0, .9)); return { duration: 1, bodyY: (1 - p) * -200, lw: p, rw: p, lh: p, rh: p, glow: p * 1.5 }; }, { desc: 'Drops in from above and bounces.' });
def('pop', (t) => { const p = easeOutBack(seg(t, 0, .35)); return { duration: .5, lw: p, rw: p, lh: p, rh: p, glow: 2 - p }; }, { desc: 'Pop in from nothing.' });
def('spin', (t) => ({ duration: .8, bodyR: ease(t / .8) * TAU, glow: 1.5 }), { desc: 'Quick 360.' });
def('jump', (t) => ({ duration: .7, bodyY: -bell(t, 0, .7) * 60, lh: 1 + bell(t, 0, .7) * .2, rh: 1 + bell(t, 0, .7) * .2, shape: 'happy' }), { desc: 'Jump.' });
def('stretch', (t) => { const p = bell(t, 0, 2); return { duration: 2, lh: 1 + p * .5, rh: 1 + p * .5, lw: 1 - p * .2, rw: 1 - p * .2, bodyY: -p * 10, lidT: p * .7 }; }, { desc: 'Tall stretch with eyes shut.' });
def('peek', (t) => { const p = easeOut(seg(t, 0, .5)) * (1 - ease(seg(t, 1.5, 2))); return { duration: 2, bodyY: (1 - p) * 180, lidT: .3 * (1 - p) }; }, { desc: 'Peeks up from below.' });
def('hide', (t) => ({ duration: 1.2, bodyY: ease(seg(t, 0, .6)) * 220, lidT: .4 }), { desc: 'Ducks out of view.' });
def('sneeze', (t) => { const p = t < .8 ? seg(t, 0, .8) : 0; const s = t >= .8 && t < 1 ? 1 : 0; return { duration: 1.5, lidT: p * .9 + s, lh: 1 + p * .2, rh: 1 + p * .2, bodyY: -p * 10 + s * 25 }; }, { desc: 'Ah… ah… choo.' });

/* ==================== TABLES ==================== */
const STATE_ANIM = { idle: 'idle', thinking: 'think', working: 'work', reviewing: 'judge', speaking: 'speak', listening: 'listen', music: 'music_vibe', error: 'error', sleep: 'sleep', offline: 'offline', planning: 'plan_subagents' };
const IDLE_FIDGETS = ['blink', 'blink', 'blink', 'double_blink', 'look_left', 'look_right', 'look_up', 'tilt_left', 'tilt_right', 'slow_blink', 'hmm', 'stretch', 'idle_look_around', 'roll_eyes', 'yawn', 'wink', 'peek', 'whistle', 'side_eye', 'heartbeat', 'idle_curious', 'idle_wiggle'];
const MUSIC_VARIANTS = ['music_vibe', 'music_headbang', 'music_sway', 'music_bounce', 'music_eyes_closed', 'music_shuffle', 'music_love', 'music_dj'];
window.NexAnims = { A, STATE_ANIM, IDLE_FIDGETS, MUSIC_VARIANTS, count: Object.keys(A).length };
