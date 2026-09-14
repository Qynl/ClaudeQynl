const noop = () => {};
const ctx = new Proxy({}, { get: (o, k) => noop, set: () => true });
let cb = null, T = 0;
global.performance = { now: () => T * 1000 }; global.requestAnimationFrame = f => { cb = f; };
global.document = { getElementById: () => ({ getContext: () => ctx }) };
global.window = global; global.innerWidth = 900; global.innerHeight = 600; global.devicePixelRatio = 1; global.addEventListener = noop;
require('../nex/web/anims.js'); require('../nex/web/eyes.js');
const E = global.NexEyes, { C, STATE, FIDGETS, MUSIC } = global.NexClips;
const step = dt => { T += dt; cb(); };
for (const v of Object.values(STATE)) if (!C[v]) throw 'state->' + v;
for (const v of [...FIDGETS, ...MUSIC]) if (!C[v]) throw 'missing ' + v;
for (const [n, c] of Object.entries(C)) { for (const k of ['enter', 'exit']) if (c[k] && (!C[c[k]] || C[c[k]].loop)) throw `${n}.${k}`; if (!c.loop && !c.dur) throw n + ' no dur'; }
step(.016); E.setMusic(true); for (let i = 0; i < 150; i++) step(.016); E.setMusic(false); for (let i = 0; i < 150; i++) step(.016);
E.setState('working', 'type'); for (let i = 0; i < 90; i++) step(.016); E.setState('idle'); for (let i = 0; i < 90; i++) step(.016);
for (const n of Object.keys(C)) { C[n].loop ? E.setLoop(n) : E.play(n); for (let i = 0; i < 30; i++) step(.016); }
const loops = Object.values(C).filter(c => c.loop).length;
console.log(`eyes ok: ${Object.keys(C).length} clips (${loops} loops, ${Object.keys(C).length - loops} one-shots)`);
