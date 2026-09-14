/* ============================================================
   NEX ANIMATION LIBRARY
   Every animation is a function (t, ctx) -> pose overrides.
   t = seconds since animation start. ctx = {beat, music, ...}
   Pose fields (all optional, additive/blended over base pose):
     lx, ly, rx, ry      eye offsets (px) per eye
     lw, lh, rw, rh      eye scale (1 = normal)
     lr, rr              eye rotation (rad)
     lidT, lidB          eyelid closure 0..1 (top/bottom) both eyes
     lLidT, rLidT ...    per-eye lids
     squint              0..1 (both lids partial)
     glow                0..2 glow intensity
     hue                 hue shift in degrees
     bodyX, bodyY, bodyR whole-face transform
     shape               'rect' | 'happy' | 'sad' | 'angry' | 'surprised' | 'sleepy' | 'wink' | 'heart' | 'x' | 'dot' | 'wide' | 'focus' | 'star'
     props               array of prop names: 'headset','glasses','zzz','bulb','gear','pencil','book','magnifier','check','cross','scale','sparks','notes','heart','question','exclaim','shield','clock','wrench','bug','wave'
     propAnim            per-prop numeric driver
     loop                true if animation should loop (else returns to idle)
     duration            seconds (for one-shots)
   ============================================================ */

const A = {};
const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
const clamp = (v, a, b) => max(a, min(b, v));
const ease = (x) => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const pulse = (t, f = 1) => (sin(t * TAU * f) + 1) / 2;
const bounce = (x) => { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + .75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + .9375; return n1 * (x -= 2.625 / d1) * x + .984375; };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

// ---------- LOOPS (states) ----------
A.idle = (t) => ({ loop: true, bodyY: sin(t * 1.2) * 3, lx: sin(t * .5) * 2, rx: sin(t * .5) * 2, glow: 1 + sin(t * 1.5) * .08 });
A.idle_look_around = (t) => { const p = (t % 6) / 6; const x = p < .3 ? -18 * ease(seg(p, 0, .15)) : p < .6 ? -18 + 36 * ease(seg(p, .35, .5)) : 18 - 18 * ease(seg(p, .7, .85)); return { loop: true, lx: x, rx: x, ly: sin(t) * 3, ry: sin(t) * 3, duration: 6 }; };
A.idle_bored = (t) => ({ loop: true, lidT: .35 + sin(t * .8) * .05, ly: 4, ry: 4, bodyY: 4 + sin(t * .7) * 2, lx: sin(t * .3) * 10, rx: sin(t * .3) * 10 });
A.idle_curious = (t) => ({ loop: true, bodyR: sin(t * .9) * .08, lh: 1.08, rh: .94, ly: -3, ry: 2 });
A.idle_wiggle = (t) => ({ loop: true, lr: sin(t * 4) * .05, rr: -sin(t * 4) * .05, bodyY: abs(sin(t * 4)) * -6 });
A.idle_breathe = (t) => ({ loop: true, lw: 1 + sin(t * .9) * .03, lh: 1 + sin(t * .9) * .05, rw: 1 + sin(t * .9) * .03, rh: 1 + sin(t * .9) * .05 });
A.sleep = (t) => ({ loop: true, lidT: .92, shape: 'sleepy', bodyY: 10 + sin(t * .8) * 4, props: ['zzz'], propAnim: t, glow: .5 });
A.doze = (t) => { const d = pulse(t, .25); return { loop: true, lidT: .5 + d * .4, bodyY: 6 + d * 8, bodyR: d * .06, glow: .7 }; };
A.listen = (t) => ({ loop: true, lw: 1.08, rw: 1.08, lh: 1.12, rh: 1.12, glow: 1.4 + sin(t * 6) * .2, bodyR: .06, ly: -4, ry: -4, props: ['wave'], propAnim: t });
A.listen_lean = (t) => ({ loop: true, bodyR: .12, bodyX: 8, lh: 1.15, rh: 1.05, glow: 1.5, props: ['wave'], propAnim: t });
A.speak = (t) => ({ loop: true, lh: 1 + sin(t * 9) * .06, rh: 1 + sin(t * 9) * .06, bodyY: sin(t * 4.5) * 3, glow: 1.3 + sin(t * 9) * .15 });
A.speak_excited = (t) => ({ loop: true, lh: 1.1 + sin(t * 12) * .1, rh: 1.1 + sin(t * 12) * .1, bodyY: sin(t * 6) * 5, bodyR: sin(t * 3) * .05, glow: 1.6, shape: 'happy' });
A.speak_calm = (t) => ({ loop: true, lh: 1 + sin(t * 5) * .03, rh: 1 + sin(t * 5) * .03, lidT: .12, bodyY: sin(t * 2) * 2 });
A.think = (t) => ({ loop: true, lx: 14, rx: 14, ly: -16, ry: -16, lidT: .25, lr: -.05, rr: -.05, bodyR: -.05, props: ['dots'], propAnim: t, glow: .9 });
A.think_hard = (t) => ({ loop: true, lx: 12 + sin(t * 2) * 6, rx: 12 + sin(t * 2) * 6, ly: -14, ry: -14, squint: .35, bodyR: -.08 + sin(t * .7) * .04, props: ['dots', 'gear'], propAnim: t });
A.idea_think = (t) => ({ loop: true, lx: -10, rx: -10, ly: -18, ry: -18, lidT: .2, bodyR: .06, props: ['dots'], propAnim: t });
A.plan = (t) => ({ loop: true, ly: 6, ry: 6, lx: sin(t * 2.5) * 14, rx: sin(t * 2.5) * 14, squint: .15, props: ['clipboard'], propAnim: t });
A.work = (t) => ({ loop: true, ly: 8, ry: 8, squint: .25, lx: sin(t * 6) * 5, rx: sin(t * 6) * 5, bodyY: abs(sin(t * 6)) * 2, props: ['gear'], propAnim: t, shape: 'focus' });
A.write = (t) => ({ loop: true, ly: 10, ry: 10, lx: ((t * 60) % 40) - 20, rx: ((t * 60) % 40) - 20, squint: .2, props: ['pencil'], propAnim: t, shape: 'focus' });
A.read = (t) => { const p = (t % 2) / 2; const x = -18 + 36 * p; return { loop: true, ly: 8, ry: 8, lx: x, rx: x, squint: .15, props: ['book'], propAnim: t }; };
A.search = (t) => ({ loop: true, lx: sin(t * 3) * 18, rx: sin(t * 3) * 18, ly: cos(t * 2) * 10, ry: cos(t * 2) * 10, lw: .95, rw: 1.15, rh: 1.15, props: ['magnifier'], propAnim: t });
A.fix = (t) => ({ loop: true, squint: .3, bodyR: sin(t * 8) * .04, bodyY: abs(sin(t * 8)) * -3, props: ['wrench'], propAnim: t, shape: 'focus' });
A.review_pos = (t) => ({ loop: true, shape: 'happy', bodyR: .05, bodyY: sin(t * 2) * 3, props: ['thumbup'], propAnim: t, hue: 60, glow: 1.3 });
A.review_neg = (t) => ({ loop: true, shape: 'angry', squint: .3, bodyR: -.05, lx: -6, rx: -6, props: ['thumbdown'], propAnim: t, hue: -40 });
A.judge = (t) => ({ loop: true, lidT: .2, bodyY: -2, props: ['scale'], propAnim: t, ly: 4, ry: 4, glow: 1.1 });
A.error = (t) => ({ loop: true, shape: 'x', bodyX: sin(t * 40) * (t < .5 ? 6 : 1), hue: -60, glow: 1.4, props: ['exclaim'], propAnim: t });
A.confused = (t) => ({ loop: true, lh: 1.1, rh: .85, ry: 4, bodyR: .1, lx: sin(t * 2) * 4, rx: sin(t * 2) * 4, props: ['question'], propAnim: t });
A.waiting_consent = (t) => ({ loop: true, lw: 1.1, rw: 1.1, lh: 1.15, rh: 1.15, glow: 1.2 + pulse(t, 1.5) * .3, props: ['question'], propAnim: t, bodyY: sin(t * 2) * 4 });
A.locked = (t) => ({ loop: true, shape: 'focus', squint: .4, props: ['shield'], propAnim: t, hue: 30, glow: 1.2 });
A.offline = (t) => ({ loop: true, lidT: .7, glow: .3, hue: -120, bodyY: 8, props: ['plug'], propAnim: t });
A.loading = (t) => ({ loop: true, lidT: .3, props: ['clock'], propAnim: t, lx: sin(t * 3) * 6, rx: sin(t * 3) * 6 });

// ---------- MUSIC (vibing) — ctx.beat is 0..1 phase, ctx.energy 0..1 ----------
A.music_start = (t) => { const p = seg(t, 0, .6); return { duration: .8, bodyY: -20 * (1 - easeOutBack(p)), lh: .8 + easeOutBack(p) * .35, rh: .8 + easeOutBack(p) * .35, props: ['headset'], propAnim: easeOutBack(p), shape: 'happy', glow: 1.5 }; };
A.music_vibe = (t, c) => { const b = c.beat || (t % .5) / .5; const k = 1 - b; return { loop: true, bodyX: sin(t * TAU * .95) * 26, bodyR: sin(t * TAU * .95) * .16, bodyY: -abs(sin(t * TAU * 1.9)) * 8, lh: 1 + k * .15, rh: 1 + k * .15, shape: 'happy', props: ['headset', 'notes'], propAnim: t, glow: 1.3 + k * .4 }; };
A.music_headbang = (t) => ({ loop: true, bodyY: abs(sin(t * TAU * 1.9)) * -22, bodyR: sin(t * TAU * 1.9) * .06, squint: .5, props: ['headset', 'notes'], propAnim: t, shape: 'focus', glow: 1.5 });
A.music_sway = (t) => ({ loop: true, bodyX: sin(t * TAU * .45) * 34, bodyR: sin(t * TAU * .45) * .22, lidT: .35, shape: 'happy', props: ['headset', 'notes'], propAnim: t });
A.music_bounce = (t) => ({ loop: true, bodyY: -abs(sin(t * TAU * 1.9)) * 16, lw: 1 + abs(sin(t * TAU * 1.9)) * .1, rw: 1 + abs(sin(t * TAU * 1.9)) * .1, lh: 1 - abs(sin(t * TAU * 1.9)) * .1, rh: 1 - abs(sin(t * TAU * 1.9)) * .1, shape: 'happy', props: ['headset', 'notes'], propAnim: t });
A.music_eyes_closed = (t) => ({ loop: true, lidT: .95, shape: 'happy', bodyX: sin(t * TAU * .5) * 20, bodyR: sin(t * TAU * .5) * .15, props: ['headset', 'notes'], propAnim: t, glow: 1.1 });
A.music_shuffle = (t) => ({ loop: true, bodyX: ((t * 2) % 2 < 1 ? 1 : -1) * 20 * abs(sin(t * TAU)), bodyY: -abs(sin(t * TAU * 2)) * 6, lr: sin(t * TAU) * .1, rr: sin(t * TAU) * .1, props: ['headset', 'notes'], propAnim: t, shape: 'happy' });
A.music_drop = (t) => { const p = seg(t, 0, .35); return { duration: 1.2, bodyY: (1 - bounce(p)) * -60, lw: 1.2, rw: 1.2, lh: .7 + bounce(p) * .5, rh: .7 + bounce(p) * .5, glow: 2.2, hue: t * 300, props: ['headset', 'sparks'], propAnim: t, shape: 'surprised' }; };
A.music_pause = (t) => { const p = ease(seg(t, 0, .5)); return { duration: .8, props: ['headset'], propAnim: 1 - p, lidT: .3 * p, bodyY: 6 * p }; };
A.music_stop = (t) => ({ duration: .6, props: t < .5 ? ['headset'] : [], propAnim: 1 - seg(t, 0, .5), bodyY: 4 });
A.music_next = (t) => { const p = ease(seg(t, 0, .4)); return { duration: .5, bodyX: sin(p * Math.PI) * 40, lx: 20 * (1 - p), rx: 20 * (1 - p), props: ['headset'], propAnim: 1 }; };
A.music_prev = (t) => { const p = ease(seg(t, 0, .4)); return { duration: .5, bodyX: -sin(p * Math.PI) * 40, lx: -20 * (1 - p), rx: -20 * (1 - p), props: ['headset'], propAnim: 1 }; };
A.music_volume_up = (t) => ({ duration: .6, lw: 1 + sin(t * 10) * .1, rw: 1 + sin(t * 10) * .1, props: ['headset', 'vol_up'], propAnim: t, glow: 1.8 });
A.music_volume_down = (t) => ({ duration: .6, lw: 1 - abs(sin(t * 10)) * .1, rw: 1 - abs(sin(t * 10)) * .1, props: ['headset', 'vol_down'], propAnim: t, glow: .7 });
A.music_love = (t) => ({ loop: true, shape: 'heart', bodyY: sin(t * 3) * 4, props: ['headset', 'heart'], propAnim: t, hue: -30, glow: 1.5 });

// ---------- ONE-SHOTS (reactions) ----------
A.blink = (t) => { const p = t / .16; const c = p < .5 ? ease(p * 2) : ease(2 - p * 2); return { duration: .16, lidT: c, lidB: c * .4 }; };
A.double_blink = (t) => { const f = (x) => { const p = x / .14; if (p < 0 || p > 1) return 0; return p < .5 ? ease(p * 2) : ease(2 - p * 2); }; const c = f(t) + f(t - .2); return { duration: .36, lidT: clamp(c, 0, 1), lidB: clamp(c, 0, 1) * .4 }; };
A.slow_blink = (t) => { const p = t / .7; const c = p < .5 ? ease(p * 2) : ease(2 - p * 2); return { duration: .7, lidT: c, lidB: c * .3, glow: 1 - c * .3 }; };
A.wink = (t) => { const p = t / .5; const c = p < .4 ? ease(p / .4) : ease((1 - p) / .6); return { duration: .5, rLidT: c, shape: 'happy', bodyR: -.04 * c }; };
A.wink_left = (t) => { const p = t / .5; const c = p < .4 ? ease(p / .4) : ease((1 - p) / .6); return { duration: .5, lLidT: c, shape: 'happy', bodyR: .04 * c }; };
A.wake = (t) => { const p = ease(seg(t, 0, .9)); return { duration: 1.4, lidT: (1 - p) * .95, bodyY: (1 - p) * 10, glow: .3 + p * 1.2, lh: .6 + p * .4, rh: .6 + p * .4, props: t < .6 ? ['zzz'] : [], propAnim: 1 - p }; };
A.wake_word = (t) => { const p = seg(t, 0, .3); return { duration: .8, lw: 1 + easeOutBack(p) * .2, rw: 1 + easeOutBack(p) * .2, lh: 1 + easeOutBack(p) * .25, rh: 1 + easeOutBack(p) * .25, bodyY: -12 * easeOutBack(p) * (1 - seg(t, .4, .8)), glow: 1 + p, ly: -6, ry: -6 }; };
A.greet = (t) => ({ duration: 1.6, shape: 'happy', bodyR: sin(t * 8) * .12 * (1 - t / 1.6), bodyY: -6, glow: 1.4, props: ['wave_hand'], propAnim: t });
A.nod = (t) => ({ duration: .9, bodyY: sin(t * TAU * 2.2) * 14 * (1 - t / .9), ly: sin(t * TAU * 2.2) * 6, ry: sin(t * TAU * 2.2) * 6 });
A.shake_head = (t) => ({ duration: .9, bodyX: sin(t * TAU * 3) * 18 * (1 - t / .9), lx: -sin(t * TAU * 3) * 6, rx: -sin(t * TAU * 3) * 6, shape: 'sad' });
A.happy = (t) => ({ duration: 2, shape: 'happy', bodyY: -abs(sin(t * 6)) * 8, glow: 1.5 });
A.laugh = (t) => ({ duration: 1.8, shape: 'happy', bodyY: sin(t * 22) * 5, bodyR: sin(t * 11) * .03, lh: .8, rh: .8, glow: 1.6 });
A.giggle = (t) => ({ duration: 1.2, shape: 'happy', lidT: .5, bodyY: sin(t * 30) * 3, bodyX: sin(t * 15) * 2 });
A.sad = (t) => ({ duration: 2.5, shape: 'sad', ly: 6, ry: 6, bodyY: 8, lidT: .3, glow: .6, hue: -40 });
A.cry = (t) => ({ duration: 3, shape: 'sad', lidT: .4, bodyY: 8 + sin(t * 12) * 2, props: ['tears'], propAnim: t, hue: -60, glow: .7 });
A.angry = (t) => ({ duration: 2, shape: 'angry', squint: .35, bodyX: sin(t * 50) * 2, hue: -90, glow: 1.6 });
A.annoyed = (t) => ({ duration: 2, shape: 'angry', lidT: .45, lx: 16, rx: 16, bodyR: -.04 });
A.surprised = (t) => { const p = easeOutBack(seg(t, 0, .25)); return { duration: 1.5, shape: 'surprised', lw: 1 + p * .25, rw: 1 + p * .25, lh: 1 + p * .35, rh: 1 + p * .35, bodyY: -10 * p, glow: 1.7, props: ['exclaim'], propAnim: t }; };
A.shocked = (t) => ({ duration: 1.8, shape: 'dot', lw: .5, rw: .5, lh: .5, rh: .5, bodyX: sin(t * 40) * 3, glow: 2, props: ['sparks'], propAnim: t });
A.scared = (t) => ({ duration: 1.8, shape: 'wide', lh: 1.3, rh: 1.3, bodyX: sin(t * 35) * 4, bodyY: 6, glow: 1.2, hue: 40 });
A.love = (t) => ({ duration: 2.5, shape: 'heart', bodyY: sin(t * 4) * 5, hue: -30, glow: 1.6, props: ['heart'], propAnim: t });
A.proud = (t) => ({ duration: 2, shape: 'happy', lidT: .35, bodyY: -6, bodyR: .05, glow: 1.5, props: ['sparks'], propAnim: t });
A.smug = (t) => ({ duration: 2, lidT: .5, shape: 'happy', lx: 12, rx: 12, bodyR: -.06 });
A.shy = (t) => ({ duration: 2.2, ly: 10, ry: 10, lx: -14, rx: -14, lidT: .3, bodyR: .08, hue: -20, glow: .9 });
A.sigh = (t) => { const p = t / 2; return { duration: 2, lidT: p < .5 ? p * 1.4 : (1 - p) * 1.4, bodyY: p < .5 ? -8 * p * 2 : 12 * (1 - p) * 2 }; };
A.yawn = (t) => { const p = sin(seg(t, 0, 2) * Math.PI); return { duration: 2.2, lidT: p * .8, lh: 1 + p * .3, rh: 1 + p * .3, lw: 1 - p * .3, rw: 1 - p * .3, bodyY: -p * 6 }; };
A.idea = (t) => { const p = easeOutBack(seg(t, 0, .3)); return { duration: 2.4, shape: 'surprised', ly: -8, ry: -8, lh: 1 + p * .2, rh: 1 + p * .2, bodyY: -8 * p, props: ['bulb'], propAnim: t, glow: 1.2 + p, hue: 30 }; };
A.eureka = (t) => ({ duration: 2, shape: 'star', bodyY: -abs(sin(t * 8)) * 14, glow: 2, hue: 50, props: ['bulb', 'sparks'], propAnim: t });
A.celebrate = (t) => ({ duration: 4, shape: 'happy', bodyY: -abs(sin(t * 7)) * 22, bodyR: sin(t * 7) * .1, glow: 1.6 + pulse(t, 4) * .6, hue: (t * 120) % 360, props: ['confetti', 'sparks'], propAnim: t });
A.success = (t) => { const p = easeOutBack(seg(t, .1, .5)); return { duration: 1.8, shape: 'happy', bodyY: -8 * p, props: ['check'], propAnim: p, glow: 1.4, hue: 70 }; };
A.fail = (t) => { const p = seg(t, 0, .4); return { duration: 2, shape: 'sad', bodyY: 12 * ease(p), lidT: .35, props: ['cross'], propAnim: ease(p), hue: -60 }; };
A.bug_found = (t) => ({ duration: 2.2, shape: 'surprised', lw: 1.1, rw: 1.1, lx: sin(t * 20) * 4, rx: sin(t * 20) * 4, props: ['bug', 'exclaim'], propAnim: t, hue: -30 });
A.bug_fixed = (t) => ({ duration: 2, shape: 'happy', props: ['bug', 'check'], propAnim: t, glow: 1.5, hue: 80, bodyY: -4 });
A.approve = (t) => ({ duration: 1.5, shape: 'happy', bodyY: sin(t * 8) * 8 * (1 - t / 1.5), props: ['thumbup'], propAnim: t });
A.disapprove = (t) => ({ duration: 1.5, shape: 'angry', bodyX: sin(t * 12) * 8 * (1 - t / 1.5), props: ['thumbdown'], propAnim: t });
A.roll_eyes = (t) => { const p = seg(t, 0, .9); const a = p * Math.PI; return { duration: 1.2, lx: cos(a) * -16, rx: cos(a) * -16, ly: -sin(a) * 16, ry: -sin(a) * 16, lidT: .3 * p }; };
A.look_left = (t) => { const p = ease(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, lx: -22 * p, rx: -22 * p }; };
A.look_right = (t) => { const p = ease(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, lx: 22 * p, rx: 22 * p }; };
A.look_up = (t) => { const p = ease(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, ly: -20 * p, ry: -20 * p }; };
A.look_down = (t) => { const p = ease(seg(t, 0, .3)) * (1 - ease(seg(t, .9, 1.3))); return { duration: 1.3, ly: 20 * p, ry: 20 * p, lidT: .25 * p }; };
A.squint_focus = (t) => ({ duration: 1.5, squint: .5, lw: 1.05, rw: 1.05, shape: 'focus' });
A.dizzy = (t) => ({ duration: 2.5, lx: cos(t * 8) * 14, ly: sin(t * 8) * 14, rx: cos(t * 8 + Math.PI) * 14, ry: sin(t * 8 + Math.PI) * 14, bodyR: sin(t * 3) * .1, props: ['stars_orbit'], propAnim: t });
A.glitch = (t) => ({ duration: .7, bodyX: (Math.random() - .5) * 30, lw: .8 + Math.random() * .5, rh: .8 + Math.random() * .5, hue: Math.random() * 360, glow: 2 });
A.shiver = (t) => ({ duration: 1.2, bodyX: sin(t * 60) * 3, bodyY: cos(t * 45) * 2, lidT: .2, hue: 60 });
A.tilt_left = (t) => ({ duration: 1.5, bodyR: -.14 * ease(seg(t, 0, .3)) * (1 - ease(seg(t, 1, 1.5))) });
A.tilt_right = (t) => ({ duration: 1.5, bodyR: .14 * ease(seg(t, 0, .3)) * (1 - ease(seg(t, 1, 1.5))) });
A.bounce_in = (t) => { const p = bounce(seg(t, 0, .9)); return { duration: 1, bodyY: (1 - p) * -200, lw: p, rw: p, lh: p, rh: p, glow: p * 1.5 }; };
A.pop = (t) => { const p = easeOutBack(seg(t, 0, .35)); return { duration: .5, lw: p, rw: p, lh: p, rh: p, glow: 2 - p }; };
A.spin = (t) => ({ duration: .8, bodyR: ease(t / .8) * TAU, glow: 1.5 });
A.jump = (t) => ({ duration: .7, bodyY: -sin(seg(t, 0, .7) * Math.PI) * 60, lh: 1 + sin(seg(t, 0, .7) * Math.PI) * .2, rh: 1 + sin(seg(t, 0, .7) * Math.PI) * .2, shape: 'happy' });
A.stretch = (t) => { const p = sin(seg(t, 0, 2) * Math.PI); return { duration: 2, lh: 1 + p * .5, rh: 1 + p * .5, lw: 1 - p * .2, rw: 1 - p * .2, bodyY: -p * 10, lidT: p * .7 }; };
A.peek = (t) => { const p = ease(seg(t, 0, .5)) * (1 - ease(seg(t, 1.5, 2))); return { duration: 2, bodyY: (1 - p) * 180, lidT: .3 * (1 - p) }; };
A.hide = (t) => ({ duration: 1.2, bodyY: ease(seg(t, 0, .6)) * 220, lidT: .4 });
A.zoom_in = (t) => { const p = ease(seg(t, 0, .8)); return { duration: 1.6, lw: 1 + p * .3, rw: 1 + p * .3, lh: 1 + p * .3, rh: 1 + p * .3, squint: p * .3, glow: 1 + p * .5 }; };
A.alert = (t) => ({ duration: 1.5, shape: 'wide', lh: 1.25, rh: 1.25, glow: 1.5 + pulse(t, 4) * .6, hue: -30, props: ['exclaim'], propAnim: t });
A.thumbs_up = (t) => ({ duration: 1.4, shape: 'happy', props: ['thumbup'], propAnim: easeOutBack(seg(t, 0, .3)), bodyY: -4 });
A.ok_sign = (t) => ({ duration: 1.4, shape: 'happy', props: ['check'], propAnim: easeOutBack(seg(t, 0, .3)), glow: 1.4 });
A.remember = (t) => ({ duration: 2, ly: -10, ry: -10, lidT: .2, props: ['brain'], propAnim: t, glow: 1.3, hue: 80 });
A.forget = (t) => ({ duration: 1.8, lidT: .3, props: ['brain', 'cross'], propAnim: t, hue: -40 });
A.compact_memory = (t) => ({ duration: 2, squint: .3, props: ['brain', 'gear'], propAnim: t, lx: sin(t * 8) * 3, rx: sin(t * 8) * 3 });
A.shield_block = (t) => { const p = easeOutBack(seg(t, 0, .3)); return { duration: 1.8, shape: 'focus', squint: .5, props: ['shield'], propAnim: p, hue: 40, glow: 1.6, bodyX: sin(t * 30) * 2 * (1 - t / 1.8) }; };
A.connected = (t) => ({ duration: 2, shape: 'happy', props: ['plug', 'check'], propAnim: t, glow: 1.5, hue: 80 });
A.disconnected = (t) => ({ duration: 2, shape: 'sad', props: ['plug', 'cross'], propAnim: t, hue: -80, glow: .7 });
A.tool_call = (t) => { const p = seg(t, 0, .3); return { duration: .6, ly: 8, ry: 8, squint: .3, glow: 1 + sin(p * Math.PI) * .8 }; };
A.tool_result = (t) => ({ duration: .5, ly: -4, ry: -4, glow: 1 + sin(seg(t, 0, .5) * Math.PI) * .5 });
A.playtest_ask = (t) => ({ duration: 3, shape: 'happy', lh: 1.1, rh: 1.1, props: ['gamepad', 'question'], propAnim: t, bodyY: sin(t * 3) * 4, glow: 1.3 });
A.gamepad = (t) => ({ loop: true, shape: 'focus', squint: .2, props: ['gamepad'], propAnim: t, bodyR: sin(t * 5) * .04, lx: sin(t * 7) * 6, rx: sin(t * 7) * 6 });
A.countdown = (t) => ({ duration: 3, lw: 1 + (t % 1) * .1, rw: 1 + (t % 1) * .1, glow: 2 - (t % 1), props: ['clock'], propAnim: t });
A.hmm = (t) => ({ duration: 2, lidT: .4, lx: -12, rx: -12, ly: -8, ry: -8, bodyR: .07, props: ['dots'], propAnim: t });
A.whistle = (t) => ({ loop: true, lidT: .3, lx: 16, rx: 16, ly: -14, ry: -14, bodyR: sin(t * 2) * .05, props: ['notes'], propAnim: t });
A.sneeze = (t) => { const p = t < .8 ? seg(t, 0, .8) : 0; const s = t >= .8 && t < 1 ? 1 : 0; return { duration: 1.5, lidT: p * .9 + s, lh: 1 + p * .2, rh: 1 + p * .2, bodyY: -p * 10 + s * 25, bodyX: 0 }; };
A.electric = (t) => ({ duration: 1, bodyX: (Math.random() - .5) * 8, glow: 2 + Math.random(), hue: 60, props: ['sparks'], propAnim: t, shape: 'wide' });
A.bow = (t) => { const p = sin(seg(t, 0, 1.5) * Math.PI); return { duration: 1.5, bodyY: p * 30, ly: p * 10, ry: p * 10, lidT: p * .5, shape: 'happy' }; };

// state -> default loop
const STATE_ANIM = { idle: 'idle', thinking: 'think', working: 'work', reviewing: 'judge', speaking: 'speak', listening: 'listen', music: 'music_vibe', error: 'error', sleep: 'sleep', offline: 'offline' };
// idle variety pool (random one-shots while idle)
const IDLE_FIDGETS = ['blink', 'blink', 'blink', 'double_blink', 'look_left', 'look_right', 'look_up', 'tilt_left', 'tilt_right', 'slow_blink', 'hmm', 'stretch', 'idle_look_around', 'roll_eyes', 'yawn', 'wink', 'peek', 'whistle'];
const MUSIC_VARIANTS = ['music_vibe', 'music_headbang', 'music_sway', 'music_bounce', 'music_eyes_closed', 'music_shuffle', 'music_love'];

window.NexAnims = { A, STATE_ANIM, IDLE_FIDGETS, MUSIC_VARIANTS, count: Object.keys(A).length };
