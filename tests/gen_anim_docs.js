// Generates the animation catalog for README.md from animations.js metadata
global.window = { addEventListener() {} };
require('../nex/web/animations.js');
const { A, STATE_ANIM, IDLE_FIDGETS, MUSIC_VARIANTS } = global.window.NexAnims;
const groups = {};
const order = ['idle', 'sleep', 'voice', 'think', 'plan', 'work', 'review', 'music', 'state', 'shot'];
for (const [n, f] of Object.entries(A)) { const m = f.meta; const g = m.kind === 'loop' ? (m.family || 'state') : 'shot'; (groups[g] = groups[g] || []).push([n, m]); }
const title = { idle: 'Idle loops', sleep: 'Sleep loops', voice: 'Voice loops', think: 'Thinking loops', plan: 'Planning loops', work: 'Working loops', review: 'Review-committee loops', music: 'Music loops (headset on/off transitions)', state: 'State loops', shot: 'One-shot reactions' };
let out = `## Animation catalog (${Object.keys(A).length} clips)\n\nGenerated from \`nex/web/animations.js\` (\`node tests/gen_anim_docs.js\`). Loops run until the state changes; one-shots layer on top. Loops with **enter / exit** clips play them when moving between families — e.g. leaving any music loop plays \`headset_off\` before idle.\n\n`;
for (const g of order) { if (!groups[g]) continue; out += `### ${title[g]}\n\n| Clip | Enter → Exit | What it looks like |\n|---|---|---|\n`; for (const [n, m] of groups[g].sort()) out += `| \`${n}\` | ${m.enter || m.exit ? `${m.enter || '–'} → ${m.exit || '–'}` : ''} | ${m.desc || ''} |\n`; out += '\n'; }
out += `**State → default loop:** ${Object.entries(STATE_ANIM).map(([k, v]) => `${k}→\`${v}\``).join(', ')}\n\n**Idle fidget pool:** ${[...new Set(IDLE_FIDGETS)].map(x => `\`${x}\``).join(' ')}\n\n**Music variants (rotate every 14 s):** ${MUSIC_VARIANTS.map(x => `\`${x}\``).join(' ')}\n`;
const fs = require('fs'); const p = __dirname + '/../README.md'; let md = fs.readFileSync(p, 'utf8');
const marker = '## Animation catalog';
md = md.includes(marker) ? md.slice(0, md.indexOf(marker)) + out : md + '\n' + out;
fs.writeFileSync(p, md); console.log('README catalog written:', Object.keys(A).length);
