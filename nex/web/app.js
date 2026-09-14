/* Nex front-end: eyes first. Everything else lives in a sheet that stays closed unless you open it. */
(() => {
  const $ = (s) => document.querySelector(s);
  const Eyes = window.NexEyes;
  const log = $('#log'), input = $('#input'), statusEl = $('#status'), statusText = $('#status-text'), thought = $('#thought'), barMid = $('#bar-mid');
  let settings = {}, voiceBackend = {}, ws, wsReady = false, reconnectT = 1000, streamEl = null;
  let planData = null, mode = 'plan', musicOn = false, pausedSince = 0;

  // ---------- websocket ----------
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { wsReady = true; reconnectT = 1000; Eyes.play('wake_stretch'); };
    ws.onclose = () => { wsReady = false; setStatus('offline', 'offline'); setTimeout(connect, reconnectT); reconnectT = Math.min(8000, reconnectT * 1.6); };
    ws.onmessage = (e) => { const { event, data } = JSON.parse(e.data); handle(event, data); };
  }
  const send = (o) => wsReady && ws.send(JSON.stringify(o));

  function setStatus(state, text, anim) {
    statusEl.className = state;
    statusText.textContent = state === 'idle' ? '' : (text || state);
    Eyes.setState(state, anim);
    thought.textContent = (state === 'working' || state === 'reviewing' || state === 'planning') ? (text || '') : '';
    if (state === 'working' || state === 'reviewing' || state === 'planning') statusText.textContent = state;
  }

  function addMsg(role, text, kind) {
    const d = document.createElement('div'); d.className = `msg ${role} ${kind || ''}`; d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    while (log.children.length > 80) log.removeChild(log.firstChild);
    return d;
  }

  function handle(ev, d) {
    switch (ev) {
      case 'hello':
        settings = d.settings; voiceBackend = d.voice_backend || {};
        setStatus(d.state, d.text); log.innerHTML = '';
        (d.history || []).forEach(m => addMsg(m.role, m.content));
        planData = d.plan; renderPlan(); setMode(d.mode || 'plan', false); setupVoice(); break;
      case 'state': setStatus(d.state, d.text, d.anim); break;
      case 'message':
        if (d.replace_stream && streamEl) { streamEl.textContent = d.text; streamEl = null; } else addMsg(d.role, d.text, d.kind);
        if (d.role === 'assistant') {
          if (d.kind === 'proactive') { barMid.textContent = d.text.slice(0, 120); Eyes.play(/bug/i.test(d.text) ? (/fixed/i.test(d.text) ? 'bug_fixed' : 'bug_found') : /finished|ready/i.test(d.text) ? 'success' : 'idea'); }
          if (d.kind === 'consent') { $('#consent').classList.remove('hidden'); openSheet('chat'); Eyes.play('playtest_ask'); }
          if (d.speak && settings.voice_enabled) speak(d.text); else reactToText(d.text);
        }
        break;
      case 'stream_start': streamEl = addMsg('assistant', ''); break;
      case 'stream': if (streamEl) { streamEl.textContent += d.delta; log.scrollTop = log.scrollHeight; } break;
      case 'tool': addMsg('assistant', `⚙ ${d.name.split('__').pop()}`, 'tool'); Eyes.play('tool_call'); break;
      case 'tool_result': addMsg('assistant', (d.blocked ? 'blocked · ' : d.error ? 'error · ' : '') + (d.text || '').slice(0, 140).replace(/\n/g, ' '), 'tool' + (d.blocked ? ' blocked' : d.error ? ' err' : '')); Eyes.play(d.blocked ? 'shield_block' : d.error ? 'side_eye' : 'tool_result'); break;
      case 'review': { const v = d.judge?.verdict; Eyes.play(v === 'pass' ? 'approve' : 'disapprove'); addMsg('assistant', `review · ${d.task}: ${v}${d.pessimist ? ` (opt ${d.optimist?.score}/pes ${d.pessimist?.score})` : ''}`, 'tool'); break; }
      case 'plan': planData = d; renderPlan(); break;
      case 'plan_stage': barMid.textContent = d.label; thought.textContent = d.label; break;
      case 'mode': setMode(d.mode, false); break;
      case 'music': onMusic(d); break;
      case 'settings': settings = d; break;
      case 'mcp': { const on = d.some(s => s.connected); if (on && !window._mcpOn) Eyes.play('connected'); window._mcpOn = on; break; }
    }
  }
  function reactToText(t) { const l = t.toLowerCase(); if (/haha|lol/.test(l)) Eyes.play('laugh'); else if (/sorry|can't|cannot/.test(l)) Eyes.play('sad'); else if (/\?$/.test(t.trim())) Eyes.play('tilt_right'); }

  // ---------- sheet ----------
  const sheet = $('#sheet');
  function openSheet(tab) { sheet.classList.remove('closed'); document.body.classList.add('sheet-open'); if (tab) showTab(tab); }
  function closeSheet() { sheet.classList.add('closed'); document.body.classList.remove('sheet-open'); input.blur(); }
  function showTab(t) { document.querySelectorAll('.sheet-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + t)); if (t === 'chat') setTimeout(() => input.focus(), 50); }
  document.querySelectorAll('.sheet-tabs [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#sheet-close').onclick = closeSheet;
  $('#bar-chat').onclick = () => sheet.classList.contains('closed') ? openSheet('chat') : closeSheet();
  $('#eyes').addEventListener('click', () => { if (!sheet.classList.contains('closed')) closeSheet(); else if (firstClick) { firstClick = false; if (settings.voice_enabled && rec && !wantRec) { wantRec = true; startRec(); Eyes.play('greet'); } } });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); sheet.classList.contains('closed') ? openSheet('chat') : closeSheet(); }
    if (e.key === 'Escape') { if ('speechSynthesis' in window) speechSynthesis.cancel(); queue.length = 0; closeSheet(); }
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); openSheet('chat'); }
  });

  // ---------- chat ----------
  $('#input-row').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; send({ type: 'user', text: t }); Eyes.play('nod'); });
  $('#consent-yes').onclick = () => { send({ type: 'consent', ok: true }); $('#consent').classList.add('hidden'); Eyes.play('thumbs_up'); };
  $('#consent-no').onclick = () => { send({ type: 'consent', ok: false }); $('#consent').classList.add('hidden'); Eyes.play('nod'); };

  // ---------- mode ----------
  const modeBtn = $('#bar-mode');
  function setMode(m, notify) { mode = m; modeBtn.classList.toggle('build', m === 'build'); modeBtn.querySelector('span').textContent = m; if (notify) send({ type: 'mode', mode: m }); }
  modeBtn.onclick = () => { const m = mode === 'plan' ? 'build' : 'plan'; setMode(m, true); Eyes.play('mode_' + m); };

  // ---------- plan / design / built ----------
  document.querySelectorAll('.plan-ctl button').forEach(b => b.onclick = () => send({ type: 'plan', cmd: b.dataset.p }));
  function renderPlan() {
    const p = planData; const body = $('#plan-body'); body.innerHTML = '';
    if (!p || !p.phases || !p.phases.length) { $('#plan-pct').textContent = ''; body.innerHTML = '<div class="phase">no plan yet — describe a game in plan mode</div>'; $('#gdd-body').innerHTML = ''; $('#ledger').innerHTML = ''; return; }
    let total = 0, done = 0;
    p.phases.forEach(ph => {
      const h = document.createElement('div'); h.className = 'phase'; h.textContent = ph.name; body.appendChild(h);
      (ph.tasks || []).forEach(t => { total++; if (t.status === 'done') done++; const d = document.createElement('div'); d.className = `task ${t.status || 'todo'}`; d.title = (t.detail || '') + (t.acceptance ? '\n\nCheck: ' + t.acceptance : ''); d.innerHTML = `<i>${t.status === 'done' ? '✓' : t.status === 'skipped' ? '!' : ''}</i><span>${t.title}${t.attempts ? ` <em>(try ${t.attempts + 1})</em>` : ''}</span>`; body.appendChild(d); });
    });
    $('#plan-pct').textContent = `${done}/${total} · ${p.status}`;
    if (p.status === 'running') barMid.textContent = `${(p.meta && p.meta.title) || 'build'} · ${done}/${total}`;
    const g = p.gdd || {}, d = g.design || {}, ar = g.architecture || {}, art = g.art || {}, q = g.qa || {};
    const li = (arr) => (arr || []).map(x => `<li>${typeof x === 'string' ? x : (x.name || x.system || JSON.stringify(x))}${x && x.effect ? ' — ' + x.effect : ''}</li>`).join('');
    const pal = Object.entries(art.palette || {}).map(([k, v]) => `<span class="sw" style="background:rgb(${v})"></span>${k} `).join('');
    $('#gdd-body').innerHTML = `<div class="gdd"><h4>${d.title || ''}</h4><p>${d.pitch || ''}</p><h4>Core loop</h4><ul>${li(d.core_loop)}</ul><h4>Progression</h4><p>${d.progression ? Object.values(d.progression).join(' → ') : ''}</p><h4>Systems</h4><ul>${li(d.systems)}</ul><h4>Monetization</h4><ul>${li(d.monetization)}</ul><h4>Palette</h4><p>${pal}</p><h4>Remotes</h4><ul>${li(ar.remotes)}</ul><h4>Playtest script</h4><ul>${li(q.playtest_script)}</ul><h4>Plan review</h4><p>optimist ${g.plan_review?.optimist?.score ?? '–'} · pessimist ${g.plan_review?.pessimist?.score ?? '–'} · ${g.plan_review?.judge?.verdict || ''}</p></div>`;
    $('#ledger').innerHTML = (p.ledger || []).map(x => `<li>${x}</li>`).join('') || '<li style="color:var(--dim)">nothing built yet</li>';
  }

  // ---------- anims tab ----------
  const picker = $('#anim-picker');
  Eyes.list().forEach(n => { const m = Eyes.meta(n); const b = document.createElement('button'); b.textContent = (m.kind === 'loop' ? '↻ ' : '') + n; b.title = m.desc || ''; b.onclick = () => { if (m.kind === 'loop') { Eyes.setLoop(n); setTimeout(() => Eyes.setLoop('idle'), 7000); } else Eyes.play(n); }; picker.appendChild(b); });

  // ---------- music ----------
  function onMusic(d) {
    const on = !!(d && d.playing), present = !!(d && d.title);
    if (present) barMid.textContent = `${on ? '▶' : '⏸'} ${d.title}${d.artist ? ' — ' + d.artist : ''}`;
    if (on && !musicOn) { musicOn = true; Eyes.setMusic(true, .7); }
    else if (!on && musicOn) { if (present) { Eyes.setMusicPaused(true); pausedSince = pausedSince || Date.now(); if (Date.now() - pausedSince > 45000) { musicOn = false; pausedSince = 0; Eyes.setMusic(false); } } else { musicOn = false; pausedSince = 0; Eyes.setMusic(false); } }
    else if (on && musicOn && pausedSince) { pausedSince = 0; Eyes.setMusicPaused(false); }
  }

  // ---------- TTS ----------
  let speaking = false; const queue = [];
  function speak(text) { queue.push(text); if (!speaking) drain(); }
  async function drain() {
    speaking = true;
    while (queue.length) {
      const text = queue.shift(); pauseRecognition();
      setStatus('speaking', '', /!|great|done/i.test(text) ? 'speak_excited' : 'speak');
      try { if ((settings.tts_engine === 'piper' || settings.tts_engine === 'auto') && voiceBackend.piper) await speakPiper(text); else await speakBrowser(text); } catch (e) { }
    }
    speaking = false; if (statusEl.className === 'speaking') setStatus('idle', ''); resumeRecognition();
  }
  function speakBrowser(text) {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) return res();
      const u = new SpeechSynthesisUtterance(text); u.lang = settings.language || 'en-US'; u.rate = 1.03; u.pitch = 1.0;
      const voices = speechSynthesis.getVoices(); const pref = voices.find(v => /Natural|Neural|Online/i.test(v.name) && v.lang.startsWith(u.lang.slice(0, 2))) || voices.find(v => v.lang.startsWith(u.lang.slice(0, 2)));
      if (pref) u.voice = pref; u.onend = res; u.onerror = res; speechSynthesis.speak(u);
    });
  }
  async function speakPiper(text) {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) return speakBrowser(text);
    const url = URL.createObjectURL(await r.blob()); await new Promise((res) => { const a = new Audio(url); a.onended = res; a.onerror = res; a.play().catch(res); }); URL.revokeObjectURL(url);
  }

  // ---------- STT + wake word ----------
  const mic = $('#bar-mic'); let rec = null, recOn = false, wantRec = false, awake = false, awakeTimer = null, paused = false, firstClick = true;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function setupVoice() {
    if (!settings.voice_enabled || !SR) return;
    if (settings.stt_engine === 'whisper' && voiceBackend.whisper) return setupWhisper();
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = settings.language || 'en-US';
    const wakeRe = new RegExp(`\\b(${(settings.wake_word || 'nex').toLowerCase()}|necks|next|nix)\\b`, 'i');
    rec.onresult = (e) => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; }
      if (!awake && wakeRe.test(final || interim)) wakeUp();
      if (awake && final) { const cmd = final.replace(new RegExp(`^.*?${wakeRe.source}[,.!]?\\s*`, 'i'), '').trim(); if (!cmd) return; clearTimeout(awakeTimer); awake = false; mic.classList.remove('wake'); send({ type: 'user', text: cmd, voice: true }); setStatus('thinking', 'thinking'); }
      else if (awake && interim) thought.textContent = interim.trim();
    };
    rec.onend = () => { recOn = false; if (wantRec && !paused) setTimeout(() => { try { rec.start(); recOn = true; } catch (e) { } }, 250); else mic.classList.remove('on'); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') wantRec = false; };
    mic.onclick = () => { wantRec = !wantRec; if (wantRec) startRec(); else { rec.stop(); mic.classList.remove('on', 'wake'); } };
    navigator.permissions?.query({ name: 'microphone' }).then(p => { if (p.state === 'granted' && !wantRec) { wantRec = true; startRec(); firstClick = false; } }).catch(() => { });
  }
  function startRec() { try { rec.start(); recOn = true; mic.classList.add('on'); } catch (e) { } }
  function wakeUp() { if ('speechSynthesis' in window) speechSynthesis.cancel(); queue.length = 0; awake = true; mic.classList.add('wake'); Eyes.play('wake_word'); setStatus('listening', 'listening'); clearTimeout(awakeTimer); awakeTimer = setTimeout(() => { awake = false; mic.classList.remove('wake'); if (statusEl.className === 'listening') setStatus('idle', ''); }, 9000); }
  function pauseRecognition() { paused = true; if (rec && recOn) try { rec.stop(); } catch (e) { } }
  function resumeRecognition() { paused = false; if (rec && wantRec && !recOn) try { rec.start(); recOn = true; } catch (e) { } }
  function setupWhisper() {
    let mr, chunks = [];
    mic.onpointerdown = async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); mr = new MediaRecorder(stream, { mimeType: 'audio/webm' }); chunks = []; mr.ondataavailable = (e) => chunks.push(e.data); mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); setStatus('thinking', 'transcribing'); const r = await fetch('/api/stt', { method: 'POST', body: new Blob(chunks, { type: 'audio/webm' }) }); const { text } = await r.json(); if (text) send({ type: 'user', text, voice: true }); else setStatus('idle', ''); }; mr.start(); mic.classList.add('on'); setStatus('listening', 'listening'); };
    mic.onpointerup = () => { mr && mr.state === 'recording' && mr.stop(); mic.classList.remove('on'); };
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  connect();
})();
