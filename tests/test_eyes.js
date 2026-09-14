// headless check of the transition system with a stub canvas
const noop = () => {};
const ctx = new Proxy({}, { get: (o, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
let rafCb = null; let T = 0;
global.performance = { now: () => T * 1000 };
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.document = { getElementById: () => ({ getContext: () => ctx, clientWidth: 900, clientHeight: 600, ownerDocument: { defaultView: null } }) };
global.window = { addEventListener: noop, devicePixelRatio: 1, innerWidth: 900, innerHeight: 600 };
global.setTimeout = (fn) => fn && null;
require('../nex/web/animations.js'); require('../nex/web/eyes.js');
const E = global.window.NexEyes; const { A } = global.window.NexAnims;
const step = (dt) => { T += dt; rafCb(); };
const src = require('fs').readFileSync(__dirname + '/../nex/web/eyes.js', 'utf8');
// all props exist
const props = new Set(); for (const f of Object.values(A)) for (const t of [0, .3, 1, 2, 3]) (f(t, {}).props || []).forEach(x => props.add(x));
const missing = [...props].filter(p => !src.includes('P.' + p + ' =')); if (missing.length) throw 'missing props ' + missing;
// every enter/exit exists and is a shot
for (const [n, f] of Object.entries(A)) for (const k of ['enter', 'exit']) if (f.meta[k]) { if (!A[f.meta[k]]) throw `${n}.${k} missing`; if (A[f.meta[k]].meta.kind !== 'shot') throw `${n}.${k} must be shot`; }
// transition: idle -> music should schedule headset_on, music -> idle should schedule headset_off
step(.016); E.setMusic(true);
const shotsAfterOn = () => (E._debug ? E._debug() : null);
E.setLoop('idle'); // request idle while music -> exit headset_off must be queued
// we can't read private state; verify via behaviour: run frames and ensure no exceptions
for (let i = 0; i < 200; i++) step(.016);
E.setMusic(false); for (let i = 0; i < 200; i++) step(.016);
E.setState('working', 'typing'); for (let i = 0; i < 120; i++) step(.016);
E.setState('planning', 'plan_subagents'); for (let i = 0; i < 120; i++) step(.016);
E.setState('idle'); for (let i = 0; i < 200; i++) step(.016);
for (const n of Object.keys(A)) { if (A[n].meta.kind === 'shot') E.play(n); else E.setLoop(n); for (let i = 0; i < 30; i++) step(.016); }
console.log('eyes ok:', Object.keys(A).length, 'clips,', props.size, 'props, transitions run without errors');
