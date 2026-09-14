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
    ws.onopen = () => { wsReady = true; reconnectT = 1000; Eyes.play('wake'); };
    ws.onclose = () => { wsReady = false; setStatus('offline', 'Nex server offline', 'offline'); setTimeout(connect, reconnectT); reconnectT = Math.min(8000, reconnectT * 1.6); };
    ws.onmessage = (e) => { const { event, data } = JSON.parse(e.data); handle(event, data); };
  }
  const send = (o) => wsReady && ws.send(JSON.stringify(o));

  function setStatus(state, text, anim) {
    statusEl.className = state;
    statusText.textContent = text || state;
    Eyes.setState(state, anim);
    if (state === 'working' || state === 'reviewing') thought.textContent = text; else thought.textContent = '';
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
          if (d.kind === 'proactive') { Eyes.play(/bug/i.test(d.text) ? (/fixed/i.test(d.text) ? 'bug_fixed' : 'bug_found') : /finished|done|ready/i.test(d.text) ? 'success' : 'idea'); }
          if (d.kind === 'consent') { $('#consent').classList.remove('hidden'); Eyes.play('playtest_ask'); }
          if (d.speak && settings.voice_enabled) speak(d.text);
          else reactToText(d.text);
        }
        break;
      case 'stream_start': streamEl = addMsg('assistant', ''); break;
      case 'stream': if (streamEl) { streamEl.textContent += d.delta; log.scrollTop = log.scrollHeight; } break;
      case 'stream_end': break;
      case 'tool': { const n = d.name.split('__').pop(); addMsg('assistant', `⚙ ${n}${d.args?.command ? ': ' + String(d.args.command).slice(0, 80).replace(/\n/g, ' ') + '…' : ''}`, 'tool'); Eyes.play('tool_call'); break; }
      case 'tool_result': addMsg('assistant', (d.blocked ? '🛡 blocked: ' : '↩ ') + (d.text || '').slice(0, 160).replace(/\n/g, ' '), 'tool' + (d.blocked ? ' blocked' : '')); Eyes.play(d.blocked ? 'shield_block' : 'tool_result'); break;
      case 'review': { const v = d.judge?.verdict; Eyes.play(v === 'pass' ? 'approve' : 'disapprove'); addMsg('assistant', `⚖ ${d.task}: optimist ${d.optimist?.score ?? '?'}/10 · pessimist ${d.pessimist?.score ?? '?'}/10 → ${v}`, 'tool'); break; }
      case 'plan': renderPlan(d); break;
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
  let musicOn = false;
  function onMusic(d) {
    const bar = $('#music-bar');
    if (d && d.title) { bar.classList.remove('hidden'); $('#music-title').textContent = `${d.playing ? '▶' : '⏸'} ${d.title}${d.artist ? ' — ' + d.artist : ''}`; }
    else bar.classList.add('hidden');
    const on = !!(d && d.playing);
    if (on !== musicOn) { musicOn = on; Eyes.setMusic(on, .7); }
  }
  document.querySelectorAll('#music-bar button').forEach(b => b.onclick = () => { const a = b.dataset.m; send({ type: 'music', action: a }); Eyes.play(a === 'next' ? 'music_next' : a === 'previous' ? 'music_prev' : 'nod'); });

  // ---------- plan ----------
  function renderPlan(p) {
    const box = $('#plan');
    if (!p || !p.phases || !p.phases.length) { box.classList.add('hidden'); return; }
    if (p.status === 'running' || p.status === 'paused') box.classList.remove('hidden');
    $('#plan-title').textContent = (p.meta && p.meta.title) || p.goal || 'Plan';
    let total = 0, done = 0;
    const body = $('#plan-body'); body.innerHTML = '';
    p.phases.forEach(ph => {
      const h = document.createElement('div'); h.className = 'phase'; h.textContent = ph.name; body.appendChild(h);
      (ph.tasks || []).forEach(t => { total++; if (t.status === 'done') done++; const d = document.createElement('div'); d.className = `task ${t.status || 'todo'}`; d.innerHTML = `<i>${t.status === 'done' ? '✓' : t.status === 'skipped' ? '!' : ''}</i><span>${t.title}</span>`; body.appendChild(d); });
    });
    const pct = total ? Math.round(done / total * 100) : 0;
    $('#plan-pct').textContent = `${done}/${total} · ${p.status}`;
    $('#plan-fill').style.width = pct + '%';
  }
  document.querySelectorAll('#plan .plan-btns button[data-p]').forEach(b => b.onclick = () => send({ type: 'plan', cmd: b.dataset.p }));
  $('#plan-close').onclick = () => $('#plan').classList.add('hidden');
  $('#btn-plan').onclick = () => $('#plan').classList.toggle('hidden');

  // ---------- anim picker ----------
  const picker = $('#anim-picker');
  Eyes.list().forEach(n => { const b = document.createElement('button'); b.textContent = n; b.onclick = () => { const def = window.NexAnims.A[n](0, {}); if (def.loop) { Eyes.setState('idle', n); setTimeout(() => Eyes.setState('idle', 'idle'), 6000); } else Eyes.play(n); }; picker.appendChild(b); });
  $('#btn-anims').onclick = () => picker.classList.toggle('hidden');

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
    document.addEventListener('pointerdown', () => { if (!wantRec && !recOn && settings.voice_enabled && localStorage.nexAutoMic !== '0') { wantRec = true; startRec(); } }, { once: true });
  }
  function startRec() { try { rec.start(); recOn = true; mic.classList.add('on'); toast(`Listening for “${settings.wake_word || 'Nex'}”`); } catch (e) { } }
  function wakeUp() {
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

  // ---------- misc ----------
  let toastT;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200); }
  window.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); } });
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  connect();
})();
