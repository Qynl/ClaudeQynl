(() => {
  const $ = s => document.querySelector(s), E = window.NexEyes;
  const log = $('#log'), input = $('#input'), status = $('#status'), mid = $('#b-mid'), sheet = $('#sheet');
  let cfg = {}, vb = {}, ws, ready = false, rt = 1000, stream = null, plan = null, mode = 'plan', music = false, pausedAt = 0;

  // ws
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { ready = true; rt = 1000; E.play('wake'); };
    ws.onclose = () => { ready = false; setStatus('offline', 'offline'); setTimeout(connect, rt); rt = Math.min(8000, rt * 1.6); };
    ws.onmessage = e => { const { event, data } = JSON.parse(e.data); on(event, data); };
  };
  const send = o => ready && ws.send(JSON.stringify(o));

  function setStatus(state, text, anim) {
    const busy = ['working', 'reviewing', 'planning', 'thinking', 'listening'].includes(state);
    status.textContent = busy ? (text || state) : (state === 'error' || state === 'offline' ? (text || state) : '');
    E.setState(state, anim);
  }
  function msg(role, text, kind) { const d = document.createElement('div'); d.className = `m ${role} ${kind || ''}`; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; while (log.children.length > 80) log.firstChild.remove(); return d; }

  function on(ev, d) {
    switch (ev) {
      case 'hello': cfg = d.settings; vb = d.voice_backend || {}; setStatus(d.state, d.text); log.innerHTML = ''; (d.history || []).forEach(m => msg(m.role, m.content)); plan = d.plan; renderPlan(); setMode(d.mode || 'plan'); voice(); break;
      case 'state': setStatus(d.state, d.text, d.anim); break;
      case 'message':
        if (d.replace_stream && stream) { stream.textContent = d.text; stream = null; } else msg(d.role, d.text, d.kind);
        if (d.role === 'assistant') {
          if (d.kind === 'proactive') { mid.textContent = d.text.slice(0, 110); E.play(/finished|ready|greenlit/i.test(d.text) ? 'success' : /bug|fail|couldn't/i.test(d.text) ? 'fail' : 'idea'); }
          if (d.kind === 'consent') { $('#consent').classList.remove('hidden'); open('chat'); E.play('alert'); }
          if (d.speak && cfg.voice_enabled) speak(d.text); else if (/\?$/.test(d.text.trim())) E.play('tilt');
        } break;
      case 'stream_start': stream = msg('assistant', ''); break;
      case 'stream': if (stream) { stream.textContent += d.delta; log.scrollTop = log.scrollHeight; } break;
      case 'tool': msg('assistant', d.name.split('__').pop(), 'tool'); break;
      case 'tool_result': msg('assistant', (d.blocked ? 'blocked · ' : d.error ? 'error · ' : '') + (d.text || '').slice(0, 140).replace(/\n/g, ' '), 'tool' + (d.blocked ? ' blocked' : d.error ? ' err' : '')); if (d.error) E.play('squint'); if (d.blocked) E.play('shake'); break;
      case 'review': { const v = d.judge?.verdict; E.play(v === 'pass' ? 'nod' : 'shake'); msg('assistant', `review · ${d.task} · ${v}${d.lenses ? ' · ' + Object.entries(d.lenses).map(([k, s]) => `${k} ${s}`).join(' ') : ''}`, 'tool'); break; }
      case 'plan': plan = d; renderPlan(); break;
      case 'plan_stage': mid.textContent = d.label; status.textContent = d.label; break;
      case 'mode': setMode(d.mode); break;
      case 'music': onMusic(d); break;
      case 'settings': cfg = d; break;
      case 'mcp': { const onl = d.some(s => s.connected); if (onl && !window._on) E.play('success'); window._on = onl; break; }
    }
  }

  // sheet
  const open = t => { sheet.classList.remove('closed'); document.body.classList.add('open'); if (t) tab(t); };
  const close = () => { sheet.classList.add('closed'); document.body.classList.remove('open'); input.blur(); };
  const tab = t => { document.querySelectorAll('#sheet nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 't-' + t)); if (t === 'chat') setTimeout(() => input.focus(), 40); };
  document.querySelectorAll('#sheet nav [data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
  $('#close').onclick = close;
  $('#b-chat').onclick = () => sheet.classList.contains('closed') ? open('chat') : close();
  let first = true;
  $('#eyes').onclick = () => { if (!sheet.classList.contains('closed')) return close(); if (first) { first = false; if (cfg.voice_enabled && rec && !want) { want = true; startRec(); E.play('happy'); } } };
  addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); sheet.classList.contains('closed') ? open('chat') : close(); }
    if (e.key === 'Escape') { speechSynthesis?.cancel(); q.length = 0; close(); }
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); open('chat'); }
  });

  // chat
  $('#row').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; send({ type: 'user', text: t }); E.play('nod'); };
  $('#c-yes').onclick = () => { send({ type: 'consent', ok: true }); $('#consent').classList.add('hidden'); E.play('nod'); };
  $('#c-no').onclick = () => { send({ type: 'consent', ok: false }); $('#consent').classList.add('hidden'); E.play('nod'); };

  // mode
  const mb = $('#b-mode');
  function setMode(m, notify) { mode = m; mb.classList.toggle('build', m === 'build'); mb.querySelector('span').textContent = m; if (notify) send({ type: 'mode', mode: m }); }
  mb.onclick = () => { setMode(mode === 'plan' ? 'build' : 'plan', true); E.play('blink2'); };

  // plan
  document.querySelectorAll('.ctl button').forEach(b => b.onclick = () => send({ type: 'plan', cmd: b.dataset.p }));
  function renderPlan() {
    const p = plan, el = $('#plan'); el.innerHTML = '';
    if (!p || !p.phases?.length) { $('#pct').textContent = ''; el.innerHTML = '<div class="ph">no plan — describe a game in plan mode</div>'; $('#gdd').innerHTML = ''; $('#ledger').innerHTML = ''; return; }
    let tot = 0, done = 0;
    p.phases.forEach(ph => { const h = document.createElement('div'); h.className = 'ph'; h.textContent = ph.name; el.appendChild(h); (ph.tasks || []).forEach(t => { tot++; if (t.status === 'done') done++; const d = document.createElement('div'); d.className = `tk ${t.status || 'todo'}`; d.title = (t.detail || '') + (t.acceptance ? '\n\nCheck: ' + t.acceptance : ''); d.innerHTML = `<i></i><span>${t.title}${t.attempts ? ` <em>· try ${t.attempts + 1}</em>` : ''}</span>`; el.appendChild(d); }); });
    $('#pct').textContent = `${done}/${tot} · ${p.status}`;
    if (p.status === 'running') mid.textContent = `${p.meta?.title || 'build'} · ${done}/${tot}`;
    const g = p.gdd || {}, de = g.design || {}, ar = g.architecture || {}, art = g.art || {}, qa = g.qa || {};
    const li = a => (a || []).map(x => `<li>${typeof x === 'string' ? x : (x.name || x.system || '')}${x?.effect ? ' — ' + x.effect : ''}</li>`).join('');
    const pal = Object.entries(art.palette || {}).map(([k, v]) => `<span class="sw" style="background:rgb(${v})"></span>${k} `).join('');
    $('#gdd').innerHTML = `<h4>${de.title || ''}</h4><p>${de.pitch || ''}</p><h4>Core loop</h4><ul>${li(de.core_loop)}</ul><h4>Progression</h4><p>${de.progression ? Object.values(de.progression).join(' → ') : ''}</p><h4>Systems</h4><ul>${li(de.systems)}</ul><h4>Monetization</h4><ul>${li(de.monetization)}</ul><h4>Palette</h4><p>${pal}</p><h4>Remotes</h4><ul>${li(ar.remotes)}</ul><h4>Playtest script</h4><ul>${li(qa.playtest_script)}</ul>${p.slice_review ? `<h4>Vertical slice</h4><p>${p.slice_review.greenlight ? 'greenlit' : 'not yet'} · ${p.slice_review.score}/10</p>` : ''}`;
    $('#ledger').innerHTML = (p.ledger || []).map(x => `<li>${x}</li>`).join('') || '<li style="color:var(--d3)">nothing built yet</li>';
  }

  // anims
  E.list().forEach(n => { const m = E.meta(n), b = document.createElement('button'); b.textContent = (m.loop ? '↻ ' : '') + n; b.title = m.desc || ''; b.onclick = () => { if (m.loop) { E.setLoop(n); setTimeout(() => E.setLoop('idle'), 7000); } else E.play(n); }; $('#anims').appendChild(b); });

  // music
  function onMusic(d) {
    const on = !!d?.playing, present = !!d?.title;
    if (present) mid.textContent = `${on ? '▶' : '⏸'} ${d.title}${d.artist ? ' — ' + d.artist : ''}`;
    if (on && !music) { music = true; E.setMusic(true); }
    else if (!on && music) { if (present) { E.setMusicPaused(true); pausedAt = pausedAt || Date.now(); if (Date.now() - pausedAt > 45000) { music = false; pausedAt = 0; E.setMusic(false); } } else { music = false; pausedAt = 0; E.setMusic(false); } }
    else if (on && music && pausedAt) { pausedAt = 0; E.setMusicPaused(false); }
  }

  // tts
  let talking = false; const q = [];
  function speak(t) { q.push(t); if (!talking) drain(); }
  async function drain() {
    talking = true;
    while (q.length) { const t = q.shift(); pauseRec(); setStatus('speaking', ''); try { if ((cfg.tts_engine === 'piper' || cfg.tts_engine === 'auto') && vb.piper) await piper(t); else await browserTTS(t); } catch (e) { } }
    talking = false; setStatus('idle', ''); resumeRec();
  }
  const browserTTS = t => new Promise(res => { if (!('speechSynthesis' in window)) return res(); const u = new SpeechSynthesisUtterance(t); u.lang = cfg.language || 'en-US'; u.rate = 1.03; const vs = speechSynthesis.getVoices(); const v = vs.find(v => /Natural|Neural|Online/i.test(v.name) && v.lang.startsWith(u.lang.slice(0, 2))) || vs.find(v => v.lang.startsWith(u.lang.slice(0, 2))); if (v) u.voice = v; u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
  async function piper(t) { const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) }); if (!r.ok) return browserTTS(t); const url = URL.createObjectURL(await r.blob()); await new Promise(res => { const a = new Audio(url); a.onended = res; a.onerror = res; a.play().catch(res); }); URL.revokeObjectURL(url); }

  // stt + wake word
  const micB = $('#b-mic'); let rec = null, recOn = false, want = false, awake = false, awakeT = null, paused = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function voice() {
    if (!cfg.voice_enabled || !SR) return;
    if (cfg.stt_engine === 'whisper' && vb.whisper) return whisper();
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = cfg.language || 'en-US';
    const wake = new RegExp(`\\b(${(cfg.wake_word || 'nex').toLowerCase()}|necks|next|nix)\\b`, 'i');
    rec.onresult = e => {
      let fin = '', inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else inter += t; }
      if (!awake && wake.test(fin || inter)) wakeUp();
      if (awake && fin) { const cmd = fin.replace(new RegExp(`^.*?${wake.source}[,.!]?\\s*`, 'i'), '').trim(); if (!cmd) return; clearTimeout(awakeT); awake = false; micB.classList.remove('wake'); send({ type: 'user', text: cmd, voice: true }); setStatus('thinking', 'thinking'); }
      else if (awake && inter) status.textContent = inter.trim().toLowerCase();
    };
    rec.onend = () => { recOn = false; if (want && !paused) setTimeout(() => { try { rec.start(); recOn = true; } catch (e) { } }, 250); else micB.classList.remove('on'); };
    rec.onerror = e => { if (e.error === 'not-allowed') want = false; };
    micB.onclick = () => { want = !want; if (want) startRec(); else { rec.stop(); micB.classList.remove('on', 'wake'); } };
    navigator.permissions?.query({ name: 'microphone' }).then(p => { if (p.state === 'granted' && !want) { want = true; startRec(); first = false; } }).catch(() => { });
  }
  function startRec() { try { rec.start(); recOn = true; micB.classList.add('on'); } catch (e) { } }
  function wakeUp() { speechSynthesis?.cancel(); q.length = 0; awake = true; micB.classList.add('wake'); E.play('alert'); setStatus('listening', 'listening'); clearTimeout(awakeT); awakeT = setTimeout(() => { awake = false; micB.classList.remove('wake'); setStatus('idle', ''); }, 9000); }
  const pauseRec = () => { paused = true; if (rec && recOn) try { rec.stop(); } catch (e) { } };
  const resumeRec = () => { paused = false; if (rec && want && !recOn) try { rec.start(); recOn = true; } catch (e) { } };
  function whisper() { let mr, ch = []; micB.onpointerdown = async () => { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); mr = new MediaRecorder(s, { mimeType: 'audio/webm' }); ch = []; mr.ondataavailable = e => ch.push(e.data); mr.onstop = async () => { s.getTracks().forEach(t => t.stop()); setStatus('thinking', 'transcribing'); const r = await fetch('/api/stt', { method: 'POST', body: new Blob(ch, { type: 'audio/webm' }) }); const { text } = await r.json(); if (text) send({ type: 'user', text, voice: true }); else setStatus('idle', ''); }; mr.start(); micB.classList.add('on'); setStatus('listening', 'listening'); }; micB.onpointerup = () => { mr?.state === 'recording' && mr.stop(); micB.classList.remove('on'); }; }
  speechSynthesis?.getVoices();
  connect();
})();
