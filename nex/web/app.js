/* NEX front-end: websocket, chat, voice (wake word + STT + TTS), plan panel */
(() => {
  const $ = (s) => document.querySelector(s);
  const Eyes = window.NexEyes;
  const log = $('#log'), input = $('#input'), statusEl = $('#status'), statusText = $('#status-text'), thought = $('#thought');
  let settings = {}, voiceBackend = { whisper: false, piper: false };
  let ws, wsReady = false, reconnectT = 1000;
  let streamEl = null;

  // ---------- websocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { wsReady = true; reconnectT = 1000; Eyes.play('wake_stretch'); };
    ws.onclose = () => { wsReady = false; setStatus('offline', 'Nex server offline', 'offline'); setTimeout(connect, reconnectT); reconnectT = Math.min(8000, reconnectT * 1.6); };
    ws.onmessage = (e) => { const { event, data } = JSON.parse(e.data); handle(event, data); };
  }
  const send = (o) => wsReady && ws.send(JSON.stringify(o));

  function setStatus(state, text, anim) {
    statusEl.className = state === 'planning' ? 'working planning' : state;
    statusText.textContent = text || state;
    Eyes.setState(state, anim);
    if (state === 'working' || state === 'reviewing') thought.textContent = text; else thought.textContent = (state === 'idle' && rec && !wantRec && settings.voice_enabled) ? 'click to enable voice' : '';
  }

  function addMsg(role, text, kind) {
    const d = document.createElement('div');
    d.className = `msg ${role} ${kind || ''}`;
    d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    while (log.children.length > 60) log.removeChild(log.firstChild);
    return d;
  }

  function handle(ev, d) {
    switch (ev) {
      case 'hello':
        settings = d.settings; voiceBackend = d.voice_backend || voiceBackend;
        Eyes.setTheme(settings.theme);
        setStatus(d.state, d.text, null);
        log.innerHTML = '';
        (d.history || []).forEach(m => addMsg(m.role, m.content));
        renderPlan(d.plan);
        setMode(d.mode || 'plan', false);
        setupVoice();
        break;
      case 'state': {
        const anim = d.anim;
        setStatus(d.state, d.text, anim);
        break;
      }
      case 'message':
        if (d.replace_stream && streamEl) { streamEl.textContent = d.text; streamEl = null; }
        else addMsg(d.role, d.text, d.kind);
        if (d.role === 'assistant') {
          if (d.kind === 'proactive' || d.kind === 'consent') showUI(false);
          if (d.kind === 'proactive') { Eyes.play(/bug/i.test(d.text) ? (/fixed/i.test(d.text) ? 'bug_fixed' : 'bug_found') : /finished|done|ready/i.test(d.text) ? 'success' : 'idea'); }
          if (d.kind === 'consent') { $('#consent').classList.remove('hidden'); Eyes.play('playtest_ask'); }
          if (d.speak && settings.voice_enabled) speak(d.text);
          else reactToText(d.text);
        }
        break;
      case 'stream_start': streamEl = addMsg('assistant', ''); showUI(false); break;
      case 'stream': if (streamEl) { streamEl.textContent += d.delta; log.scrollTop = log.scrollHeight; } break;
      case 'stream_end': break;
      case 'tool': { const n = d.name.split('__').pop(); addMsg('assistant', `⚙ ${n}${d.args?.command ? ': ' + String(d.args.command).slice(0, 80).replace(/\n/g, ' ') + '…' : ''}`, 'tool'); Eyes.play('tool_call'); break; }
      case 'tool_result': addMsg('assistant', (d.blocked ? '🛡 blocked: ' : d.error ? '⚠ ' : '↩ ') + (d.text || '').slice(0, 160).replace(/\n/g, ' '), 'tool' + (d.blocked ? ' blocked' : d.error ? ' err' : '')); Eyes.play(d.blocked ? 'shield_block' : d.error ? 'side_eye' : 'tool_result'); break;
      case 'review': { const v = d.judge?.verdict; Eyes.play(v === 'pass' ? 'approve' : (d.pessimist?.score <= 3 ? 'facepalm' : 'disapprove')); addMsg('assistant', `⚖ ${d.task}: optimist ${d.optimist?.score ?? '?'}/10 · pessimist ${d.pessimist?.score ?? '?'}/10 → ${v}`, 'tool'); break; }
      case 'plan': planData = d; renderPlan(d); break;
      case 'plan_stage': planStage = d; if (planData) renderPlan(planData); else { $('#plan').classList.remove('hidden'); $('#plan-title').textContent = 'Pre-production'; $('#plan-body').innerHTML = `<div class="stage">▸ <b>${d.label}</b></div>`; } break;
      case 'mode': setMode(d.mode, false); break;
      case 'music': onMusic(d); break;
      case 'settings': settings = d; Eyes.setTheme(settings.theme); break;
      case 'mcp': { const on = d.some(s => s.connected); if (on && !window._mcpWasOn) Eyes.play('connected'); window._mcpWasOn = on; break; }
      case 'memory': break;
    }
  }

  function reactToText(t) {
    const l = t.toLowerCase();
    if (/haha|lol|😂/.test(l)) Eyes.play('laugh');
    else if (/sorry|can't|cannot|unable/.test(l)) Eyes.play('sad');
    else if (/\?$/.test(t.trim())) Eyes.play('tilt_right');
    else if (/great|awesome|done|finished/.test(l)) Eyes.play('happy');
  }

  // ---------- chat ----------
  $('#input-row').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; send({ type: 'user', text: t }); Eyes.play('nod'); });
  $('#consent-yes').onclick = () => { send({ type: 'consent', ok: true }); $('#consent').classList.add('hidden'); Eyes.play('thumbs_up'); };
  $('#consent-no').onclick = () => { send({ type: 'consent', ok: false }); $('#consent').classList.add('hidden'); Eyes.play('nod'); };

  // ---------- music ----------
  let musicOn = false, pausedSince = 0, planData = null, planStage = null, planTab = 'tasks';
  function onMusic(d) {
    const bar = $('#music-bar');
    if (d && d.title) { bar.classList.remove('hidden'); $('#music-title').textContent = `${d.playing ? '▶' : '⏸'} ${d.title}${d.artist ? ' — ' + d.artist : ''}`; }
    else bar.classList.add('hidden');
    const on = !!(d && d.playing);
    const present = !!(d && d.title);
    if (on && !musicOn) { musicOn = true; Eyes.setMusic(true, .7); }
    else if (!on && musicOn) { if (present) { Eyes.setMusicPaused(true); pausedSince = pausedSince || Date.now(); if (Date.now() - pausedSince > 45000) { musicOn = false; pausedSince = 0; Eyes.setMusic(false); } } else { musicOn = false; pausedSince = 0; Eyes.setMusic(false); } }
    else if (on && musicOn && pausedSince) { pausedSince = 0; Eyes.setMusicPaused(false); }
  }
  document.querySelectorAll('#music-bar button').forEach(b => b.onclick = () => { const a = b.dataset.m; send({ type: 'music', action: a }); Eyes.play(a === 'next' ? 'music_next' : a === 'previous' ? 'music_prev' : 'nod'); });

  // ---------- mode chip ----------
  const chip = $('#mode-chip'); let mode = 'plan';
  function setMode(m, notify) { mode = m; chip.classList.toggle('build', m === 'build'); chip.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); if (notify) send({ type: 'mode', mode: m }); }
  chip.querySelectorAll('button').forEach(b => b.onclick = (e) => { e.stopPropagation(); if (b.dataset.mode !== mode) { setMode(b.dataset.mode, true); Eyes.play('mode_' + b.dataset.mode); } });

  // ---------- plan ----------
  function renderPlan(p) {
    const box = $('#plan');
    if (!p || !p.phases || !p.phases.length) { if (!planStage) box.classList.add('hidden'); return; }
    if ((p.status === 'running' || p.status === 'paused' || p.status === 'planned') && document.body.classList.contains('ui-visible') && !box.dataset.userClosed) box.classList.remove('hidden');
    $('#plan-title').textContent = (p.meta && p.meta.title) || p.goal || 'Plan';
    let total = 0, done = 0;
    p.phases.forEach(ph => (ph.tasks || []).forEach(t => { total++; if (t.status === 'done') done++; }));
    const body = $('#plan-body'); body.innerHTML = '';
    if (planTab === 'tasks') {
      p.phases.forEach(ph => {
        const h = document.createElement('div'); h.className = 'phase'; h.textContent = ph.name; body.appendChild(h);
        (ph.tasks || []).forEach(t => { const d = document.createElement('div'); d.className = `task ${t.status || 'todo'}`; d.title = (t.detail || '') + (t.acceptance ? '\n\nCheck: ' + t.acceptance : ''); d.innerHTML = `<i>${t.status === 'done' ? '✓' : t.status === 'skipped' ? '!' : ''}</i><span>${t.title}${t.attempts ? ` <em>(try ${t.attempts + 1})</em>` : ''}</span>`; body.appendChild(d); });
      });
    } else if (planTab === 'gdd') {
      const g = p.gdd || {}, d = g.design || {}, ar = g.architecture || {}, art = g.art || {}, q = g.qa || {};
      const li = (arr) => (arr || []).map(x => `<li>${typeof x === 'string' ? x : (x.name || x.system || JSON.stringify(x))}${x && x.effect ? ' — ' + x.effect : ''}</li>`).join('');
      const pal = Object.entries(art.palette || {}).map(([k, v]) => `<span class="sw" style="background:rgb(${v})"></span>${k} `).join('');
      body.innerHTML = `<div class="gdd">
        <h4>Pitch</h4><p>${d.pitch || ''}</p>
        <h4>Core loop</h4><ul>${li(d.core_loop)}</ul>
        <h4>Progression</h4><p>${d.progression ? Object.values(d.progression).join(' → ') : ''}</p>
        <h4>Systems (${(d.systems || []).length})</h4><ul>${li(d.systems)}</ul>
        <h4>Monetization</h4><ul>${li(d.monetization)}</ul>
        <h4>Palette</h4><p>${pal}</p>
        <h4>Remotes</h4><ul>${li(ar.remotes)}</ul>
        <h4>Playtest script</h4><ul>${li(q.playtest_script)}</ul>
        <h4>Plan review</h4><p>Optimist ${g.plan_review?.optimist?.score ?? '?'}/10 · Pessimist ${g.plan_review?.pessimist?.score ?? '?'}/10 · ${g.plan_review?.judge?.verdict || ''}</p>
      </div>`;
    } else {
      body.innerHTML = `<ul class="ledger">${(p.ledger || []).map(x => `<li>${x}</li>`).join('') || '<li style="color:var(--dim)">nothing built yet</li>'}</ul>`;
    }
    const pct = total ? Math.round(done / total * 100) : 0;
    $('#plan-pct').textContent = `${done}/${total} · ${p.status}`;
    $('#plan-fill').style.width = pct + '%';
  }
  document.querySelectorAll('.plan-tabs button').forEach(b => b.onclick = () => { planTab = b.dataset.tab; document.querySelectorAll('.plan-tabs button').forEach(x => x.classList.toggle('on', x === b)); if (planData) renderPlan(planData); });
  document.querySelectorAll('#plan .plan-btns button[data-p]').forEach(b => b.onclick = () => send({ type: 'plan', cmd: b.dataset.p }));
  $('#plan-close').onclick = () => { $('#plan').classList.add('hidden'); $('#plan').dataset.userClosed = '1'; };
  $('#btn-plan').onclick = () => { delete $('#plan').dataset.userClosed; $('#plan').classList.toggle('hidden'); };

  // ---------- anim picker ----------
  const picker = $('#anim-picker');
  Eyes.list().forEach(n => { const m = Eyes.meta(n); const b = document.createElement('button'); b.textContent = (m.kind === 'loop' ? '↻ ' : '') + n; b.title = (m.desc || '') + (m.enter ? `\nenter: ${m.enter}` : '') + (m.exit ? `\nexit: ${m.exit}` : ''); b.onclick = () => { if (m.kind === 'loop') { Eyes.setLoop(n); setTimeout(() => Eyes.setLoop('idle'), 7000); } else Eyes.play(n); }; picker.appendChild(b); });
  $('#btn-anims').onclick = () => picker.classList.toggle('hidden');
  $('#btn-pip').onclick = async () => {
    // Document Picture-in-Picture (Chrome/Edge 116+): a tiny always-on-top window with just the eyes + status.
    if (!('documentPictureInPicture' in window)) return toast('Always-on-top needs Chrome/Edge 116+');
    const pip = await documentPictureInPicture.requestWindow({ width: 420, height: 300 });
    [...document.styleSheets].forEach(ss => { try { const st = document.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join(''); pip.document.head.appendChild(st); } catch (e) { } });
    pip.document.body.style.background = '#07090f';
    const c = document.getElementById('eyes'), st = document.getElementById('status'), th = document.getElementById('thought');
    pip.document.body.append(c, st, th);
    pip.addEventListener('pagehide', () => { document.body.prepend(th); document.body.prepend(st); document.body.prepend(c); window.dispatchEvent(new Event('resize')); });
    pip.addEventListener('resize', () => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  };

  // ---------- TTS ----------
  let speaking = false;
  const queue = [];
  async function speak(text) {
    queue.push(text); if (!speaking) drain();
  }
  async function drain() {
    speaking = true;
    while (queue.length) {
      const text = queue.shift();
      pauseRecognition();
      setStatus('speaking', 'Speaking', /!|great|awesome|done/i.test(text) ? 'speak_excited' : 'speak');
      try {
        if ((settings.tts_engine === 'piper' || settings.tts_engine === 'auto') && voiceBackend.piper) await speakPiper(text);
        else await speakBrowser(text);
      } catch (e) { console.warn('tts', e); }
    }
    speaking = false;
    if (statusEl.className === 'speaking') setStatus('idle', 'Ready', 'idle');
    resumeRecognition();
  }
  function speakBrowser(text) {
    return new Promise((res) => {
      if (!('speechSynthesis' in window)) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = settings.language || 'en-US'; u.rate = 1.03; u.pitch = 1.05;
      const voices = speechSynthesis.getVoices();
      const pref = voices.find(v => /Natural|Neural|Online/i.test(v.name) && v.lang.startsWith(u.lang.slice(0, 2))) || voices.find(v => v.lang.startsWith(u.lang.slice(0, 2)));
      if (pref) u.voice = pref;
      u.onend = res; u.onerror = res;
      speechSynthesis.speak(u);
    });
  }
  async function speakPiper(text) {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) return speakBrowser(text);
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    await new Promise((res) => { const a = new Audio(url); a.onended = res; a.onerror = res; a.play().catch(res); });
    URL.revokeObjectURL(url);
  }

  // ---------- STT + wake word ----------
  const mic = $('#mic');
  let rec = null, recOn = false, wantRec = false, awake = false, awakeTimer = null, paused = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function setupVoice() {
    if (!settings.voice_enabled) { mic.title = 'Voice disabled in settings'; return; }
    if (settings.stt_engine === 'whisper' && voiceBackend.whisper) { setupWhisperPushToTalk(); return; }
    if (!SR) { mic.title = 'Speech recognition needs Chrome/Edge'; return; }
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = settings.language || 'en-US';
    rec.onresult = (e) => {
      let final = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; }
      const wake = (settings.wake_word || 'nex').toLowerCase();
      const heard = (final || interim).toLowerCase();
      if (!awake && new RegExp(`\\b(${wake}|necks|next|nix)\\b`).test(heard)) { wakeUp(); }
      if (awake && final) {
        let cmd = final.replace(new RegExp(`^.*?\\b(${wake}|necks|next|nix)\\b[,.!]?\\s*`, 'i'), '').trim();
        if (!cmd) { return; }
        clearTimeout(awakeTimer); awake = false; mic.classList.remove('wake');
        send({ type: 'user', text: cmd, voice: true });
        setStatus('thinking', 'Thinking…', 'think');
      } else if (awake && interim) { thought.textContent = '“' + interim.trim() + '”'; }
    };
    rec.onend = () => { recOn = false; if (wantRec && !paused) setTimeout(() => { try { rec.start(); recOn = true; } catch (e) { } }, 250); else mic.classList.remove('on'); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { wantRec = false; toast('Microphone permission denied'); } };
    mic.onclick = () => { wantRec = !wantRec; if (wantRec) startRec(); else { rec.stop(); mic.classList.remove('on', 'wake'); setStatus('idle', 'Ready', 'idle'); } };
    // Try to auto-start listening (needs prior permission) after first user gesture
    // permission already granted earlier? start immediately without a click
    navigator.permissions?.query({ name: 'microphone' }).then(p => { if (p.state === 'granted' && !wantRec) { wantRec = true; startRec(); firstClick = false; } }).catch(() => {});
  }
  function startRec() { try { rec.start(); recOn = true; mic.classList.add('on'); } catch (e) { } }
  function wakeUp() {
    if ('speechSynthesis' in window) speechSynthesis.cancel(); queue.length = 0; // barge-in: stop talking when user says the wake word
    awake = true; mic.classList.add('wake'); Eyes.play('wake_word');
    setStatus('listening', 'Listening…', 'listen');
    clearTimeout(awakeTimer); awakeTimer = setTimeout(() => { awake = false; mic.classList.remove('wake'); if (statusEl.className === 'listening') setStatus('idle', 'Ready', 'idle'); }, 9000);
  }
  function pauseRecognition() { paused = true; if (rec && recOn) try { rec.stop(); } catch (e) { } }
  function resumeRecognition() { paused = false; if (rec && wantRec && !recOn) try { rec.start(); recOn = true; } catch (e) { } }

  // local whisper: push to talk (hold mic)
  function setupWhisperPushToTalk() {
    let mr, chunks = [];
    mic.title = 'Hold to talk (Whisper)';
    const start = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mr = new MediaRecorder(stream, { mimeType: 'audio/webm' }); chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setStatus('thinking', 'Transcribing…', 'think');
        const r = await fetch('/api/stt', { method: 'POST', body: new Blob(chunks, { type: 'audio/webm' }) });
        const { text } = await r.json();
        if (text) send({ type: 'user', text, voice: true }); else setStatus('idle', 'Ready', 'idle');
      };
      mr.start(); mic.classList.add('on'); setStatus('listening', 'Listening…', 'listen');
    };
    mic.onpointerdown = start; mic.onpointerup = () => { mr && mr.state === 'recording' && mr.stop(); mic.classList.remove('on'); };
  }

  // ---------- minimal UI: drawer toggle + auto-hide ----------
  const chat = $('#chat'); let hideT;
  function showUI(persist) { chat.classList.remove('collapsed'); document.body.classList.add('ui-visible'); clearTimeout(hideT); if (!persist) hideT = setTimeout(hideUI, 12000); }
  function hideUI() { if (document.activeElement === input && input.value) return; chat.classList.add('collapsed'); document.body.classList.remove('ui-visible'); picker.classList.add('hidden'); input.blur(); }
  window.toggleUI = () => chat.classList.contains('collapsed') ? showUI(true) : hideUI();
  let firstClick = true;
  document.getElementById('eyes').addEventListener('click', () => { if (firstClick) { firstClick = false; if (settings.voice_enabled && rec && !wantRec) { wantRec = true; startRec(); Eyes.play('greet'); return; } } window.toggleUI(); });
  document.addEventListener('mousemove', () => { if (!chat.classList.contains('collapsed')) { clearTimeout(hideT); hideT = setTimeout(hideUI, 12000); } });
  input.addEventListener('focus', () => showUI(true));
  // the mic status lives in a tiny dot when the drawer is closed
  const micDot = $('#mic-dot');
  new MutationObserver(() => { micDot.className = mic.className; }).observe(mic, { attributes: true, attributeFilter: ['class'] });

  // ---------- misc ----------
  let toastT;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200); }
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); showUI(true); input.focus(); }
    if (e.key === 'Tab') { e.preventDefault(); window.toggleUI(); }
    if (e.key === 'Escape') { if ('speechSynthesis' in window) speechSynthesis.cancel(); queue.length = 0; input.blur(); }
    if (e.key === 'm' && document.activeElement !== input) { mic.click(); }
    if (e.key === ' ' && document.activeElement !== input && rec && wantRec && !awake) { e.preventDefault(); wakeUp(); }
  });
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  connect();
})();
