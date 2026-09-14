/* ============================================================================
   NEX · animation library (v3)
   ----------------------------------------------------------------------------
   Philosophy: every clip returns a TARGET pose; a spring engine in eyes.js moves
   the real pose toward it. Clips never fight each other, nothing snaps, and any
   change of state is naturally eased. Props (headset, etc.) are booleans on the
   pose — the renderer fades/slides them with their own springs.

   Pose fields (targets):
     x, y        eye look offset (px)             sx, sy   eye scale
     lid         top lid 0..1   (both)            lidL, lidR  per-eye top lid
     lower       bottom lid 0..1
     tilt        whole-face rotation (rad)        px, py   whole-face offset
     mouthless "expression" via shape: 'rect' | 'happy' | 'sad' | 'angry' | 'focus' | 'surprised' | 'closed'
     glow        0..1.6
     headset, dots, spinner, check, cross, bulb, wave, bars, note  -> 0|1 prop presence
   Clip = { loop: bool, dur?: sec, at(t) -> partial pose, desc, enter?, exit? }
   ============================================================================ */
(() => {
  const TAU = Math.PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const bell = (t, a, b) => sin(seg(t, a, b) * Math.PI);
  const wobble = (t, f = 1) => sin(t * 1.7 * f) * .5 + sin(t * 2.9 * f + 1.3) * .3 + sin(t * 4.3 * f + 2.1) * .2;
  const C = {};
  const L = (n, at, o = {}) => C[n] = Object.assign({ loop: true, at }, o);
  const S = (n, dur, at, o = {}) => C[n] = Object.assign({ loop: false, dur, at }, o);

  /* ---------- CORE LOOPS (10) ---------- */
  L('idle', t => ({ py: sin(t * 1.1) * 3 + wobble(t, .3), tilt: wobble(t, .2) * .01, x: wobble(t, .35) * 3 }), { desc: 'Neutral. Slow float, faint drift.' });
  L('listen', t => ({ sy: 1.08, sx: 1.03, y: -4, tilt: .04, glow: 1.25, wave: 1 }), { desc: 'Attentive: eyes open a little, slight lean, sound wave.' });
  L('speak', t => ({ sy: 1 + sin(t * 9) * .04, py: sin(t * 4.5) * 2 + wobble(t, 2), glow: 1.15 }), { desc: 'Talking: syllable flicker, gentle nod.' });
  L('think', t => ({ x: 16, y: -14, lid: .22, tilt: -.05, dots: 1 }), { desc: 'Looks up-right, relaxed lids, three dots.' });
  L('plan', t => ({ y: 8, x: sin(t * 2.2) * 12, lid: .12, shape: 'focus', dots: 1 }), { desc: 'Reads down a list: eyes scan left-right, slightly lowered.' });
  L('work', t => ({ y: 8, x: sin(t * 5) * 5, lid: .18, shape: 'focus', spinner: 1 }), { desc: 'Focused: small quick eye movements, spinner.', enter: 'work_in', exit: 'work_out' });
  L('type', t => ({ y: 9 + (Math.floor(t * 1.4) % 4) * 2, x: ((t * 80) % 44) - 22, lid: .22, shape: 'focus', bars: 1 }), { desc: 'Writing code line by line.', enter: 'work_in', exit: 'work_out' });
  L('read', t => ({ y: 7, x: -16 + 32 * ((t % 2.2) / 2.2), lid: .12, shape: 'focus' }), { desc: 'Reads lines across.', enter: 'work_in', exit: 'work_out' });
  L('review', t => ({ lid: .15, y: 3, x: sin(t * .9) * 6, tilt: sin(t * .9) * .03 }), { desc: 'Weighs it up: slow left-right, slight tilt.' });
  L('error', t => ({ shape: 'closed', lid: 1, px: t < .5 ? sin(t * 45) * 5 : 0, glow: .6, cross: 1 }), { desc: 'Eyes shut, brief shake, cross above.' });

  /* ---------- MUSIC (6) ---------- */
  const M = { enter: 'headset_on', exit: 'headset_off' };
  L('music', (t, c) => { const b = c.beat; return { px: sin(t * TAU * .95) * 22, tilt: sin(t * TAU * .95) * .14, py: -abs(sin(t * TAU * 1.9)) * 7, sy: 1 + (1 - b) * .08, shape: 'happy', headset: 1, note: 1 }; }, Object.assign({ desc: 'Vibing: sways and bounces on the beat.' }, M));
  L('music_nod', t => ({ py: abs(sin(t * TAU * 1.9)) * -18, tilt: sin(t * TAU * 1.9) * .04, lid: .45, shape: 'focus', headset: 1 }), Object.assign({ desc: 'Head-nodding, eyes half closed.' }, M));
  L('music_sway', t => ({ px: sin(t * TAU * .45) * 30, tilt: sin(t * TAU * .45) * .2, lid: .35, shape: 'happy', headset: 1, note: 1 }), Object.assign({ desc: 'Slow wide sway, dreamy.' }, M));
  L('music_closed', t => ({ lid: .96, px: sin(t * TAU * .5) * 16, tilt: sin(t * TAU * .5) * .12, headset: 1, glow: .9 }), Object.assign({ desc: 'Eyes closed, lost in it.' }, M));
  L('music_paused', t => ({ lid: .3, py: 3 + sin(t) * 2, headset: 1 }), Object.assign({ desc: 'Paused, still wearing the headset.' }, M));
  L('music_dj', (t, c) => ({ tilt: -.16, px: -10, py: -abs(sin(t * TAU * 1.9)) * 5, lidL: .35, lidR: .1, x: c.beat < .3 ? sin(t * TAU * 3.8) * 4 : 0, shape: 'focus', headset: 1, bars: 1 }), Object.assign({ desc: 'DJ: tilted, one lid down, scratch wobble, equalizer.' }, M));

  /* ---------- TRANSITIONS (6) — designed as one-shots that overlap the loop change ---------- */
  S('headset_on', 1.1, t => ({ headset: t > .05 ? 1 : 0, py: -5 * bell(t, .55, 1.05), sy: 1 + bell(t, .6, 1.05) * .12, lid: bell(t, .72, .92) * .7, shape: t > .8 ? 'happy' : 'rect' }), { desc: 'Headset lowers on from above, small settle bounce, happy blink.' });
  S('headset_off', 1.15, t => ({ headset: t < .18 ? 1 : 0, py: 3 * seg(t, 0, .35), lid: bell(t, 0, .3) * .45, shape: t < .25 ? 'happy' : 'rect', tilt: sin(t * 22) * .015 * bell(t, .85, 1.15) }), { desc: 'Lifts the headset off, shakes it out, settles.' });
  S('work_in', .8, t => ({ py: -6 * bell(t, 0, .5), sx: 1 + bell(t, 0, .5) * .05, y: 8 * seg(t, .2, .7), lid: .18 * seg(t, .2, .7) }), { desc: 'Rolls shoulders, drops gaze to the desk.' });
  S('work_out', .8, t => ({ y: 8 * (1 - seg(t, 0, .5)), lid: bell(t, .45, .75), py: -4 * bell(t, .3, .8) }), { desc: 'Lifts gaze, satisfied blink.' });
  S('wake', 2.2, t => ({ lid: (1 - seg(t, 0, .9)) * .96 + bell(t, 1.6, 1.9), sy: 1 + bell(t, .7, 1.6) * .35, sx: 1 - bell(t, .7, 1.6) * .12, py: 8 * (1 - seg(t, 0, .9)) - bell(t, .7, 1.6) * 10, glow: .3 + seg(t, 0, 1) * .7 }), { desc: 'Opens, tall stretch, blink.' });
  S('sleep_in', 1.6, t => ({ lid: seg(t, 0, 1.4) * .94, py: seg(t, 0, 1.4) * 8, y: seg(t, 0, 1.4) * 5, glow: 1 - seg(t, 0, 1.4) * .5 }), { desc: 'Lids sink, glow dims.' });
  L('sleep', t => ({ lid: .94, py: 8 + sin(t * .8) * 3, y: 5, glow: .5 }), { desc: 'Asleep. Slow breathing.', enter: 'sleep_in', exit: 'wake' });

  /* ---------- REACTIONS (20) ---------- */
  S('blink', .18, t => ({ lid: bell(t, 0, .18), lower: bell(t, 0, .18) * .35 }), { desc: 'Blink.' });
  S('blink2', .4, t => ({ lid: Math.max(bell(t, 0, .16), bell(t, .22, .38)) }), { desc: 'Double blink.' });
  S('wink', .5, t => ({ lidR: bell(t, 0, .5), shape: 'happy', tilt: -.03 * bell(t, 0, .5) }), { desc: 'Wink.' });
  S('nod', .9, t => ({ py: sin(t * TAU * 2.2) * 12 * (1 - t / .9), y: sin(t * TAU * 2.2) * 5 }), { desc: 'Yes.' });
  S('shake', .9, t => ({ px: sin(t * TAU * 3) * 14 * (1 - t / .9), x: -sin(t * TAU * 3) * 5 }), { desc: 'No.' });
  S('glance_l', 1.3, t => ({ x: -22 * seg(t, 0, .25) * (1 - seg(t, .9, 1.3)) }), { desc: 'Glance left.' });
  S('glance_r', 1.3, t => ({ x: 22 * seg(t, 0, .25) * (1 - seg(t, .9, 1.3)) }), { desc: 'Glance right.' });
  S('glance_u', 1.3, t => ({ y: -18 * seg(t, 0, .25) * (1 - seg(t, .9, 1.3)) }), { desc: 'Glance up.' });
  S('tilt', 1.6, t => ({ tilt: .13 * seg(t, 0, .3) * (1 - seg(t, 1.1, 1.6)) }), { desc: 'Head tilt — curious.' });
  S('squint', 1.6, t => ({ lid: .35 * bell(t, 0, 1.6), lower: .25 * bell(t, 0, 1.6), sx: 1 + .04 * bell(t, 0, 1.6) }), { desc: 'Narrows eyes.' });
  S('happy', 1.8, t => ({ shape: 'happy', py: -abs(sin(t * 6)) * 6 * (1 - t / 1.8) }), { desc: 'Happy hop.' });
  S('sad', 2.4, t => ({ shape: 'sad', y: 6, py: 6, lid: .3, glow: .7 }), { desc: 'Sad.' });
  S('surprised', 1.4, t => ({ shape: 'surprised', sx: 1 + .18 * (1 - seg(t, .9, 1.4)), sy: 1 + .28 * (1 - seg(t, .9, 1.4)), py: -8 * (1 - seg(t, .9, 1.4)), glow: 1.4 }), { desc: 'Round wide eyes, pop up.' });
  S('idea', 2.2, t => ({ shape: 'surprised', y: -8, py: -6, glow: 1.4, bulb: t < 1.9 ? 1 : 0 }), { desc: 'Lightbulb.' });
  S('success', 1.6, t => ({ shape: 'happy', py: -5, check: t > .1 && t < 1.4 ? 1 : 0, glow: 1.25 }), { desc: 'Check mark.' });
  S('fail', 1.8, t => ({ shape: 'sad', py: 8, lid: .3, cross: t > .1 && t < 1.6 ? 1 : 0, glow: .7 }), { desc: 'Cross mark.' });
  S('celebrate', 3, t => ({ shape: 'happy', py: -abs(sin(t * 7)) * 18, tilt: sin(t * 7) * .08, glow: 1.4 + sin(t * 20) * .2 }), { desc: 'Bouncing celebration.' });
  S('sigh', 2, t => ({ lid: t < 1 ? t * .7 : (2 - t) * .7, py: t < 1 ? -8 * t : 12 * (2 - t) * .5 }), { desc: 'Inhale up, exhale down.' });
  S('yawn', 2.2, t => ({ lid: bell(t, 0, 2) * .8, sy: 1 + bell(t, 0, 2) * .3, sx: 1 - bell(t, 0, 2) * .25, py: -bell(t, 0, 2) * 6 }), { desc: 'Yawn.' });
  S('alert', 1.2, t => ({ sy: 1.2, glow: 1.5, py: -4 }), { desc: 'Attention.' });

  const STATE = { idle: 'idle', listening: 'listen', speaking: 'speak', thinking: 'think', planning: 'plan', working: 'work', reviewing: 'review', error: 'error', music: 'music', sleep: 'sleep', offline: 'sleep' };
  const FIDGETS = ['blink', 'blink', 'blink', 'blink', 'blink2', 'glance_l', 'glance_r', 'glance_u', 'tilt', 'squint', 'wink', 'sigh', 'yawn'];
  const MUSIC = ['music', 'music_nod', 'music_sway', 'music_closed', 'music_dj'];
  window.NexClips = { C, STATE, FIDGETS, MUSIC };
})();
