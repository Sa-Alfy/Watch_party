'use strict';

(() => {
  /* ---------- DOM elements ---------- */
  const $ = (id) => document.getElementById(id);

  // Screens
  const landingScreen = $('landing');
  const landingName   = $('landingName');
  const createBtn     = $('createBtn');

  const joinScreen = $('join');
  const joinCode   = $('joinCode');
  const joinName   = $('joinName');
  const enterBtn   = $('enterBtn');
  const joinError  = $('joinError');

  const roomScreen  = $('room');
  const movieTitle  = $('movieTitle');
  const controlMode = $('controlMode');
  const waitModeChk = $('waitMode');
  const changeMovie = $('changeMovie');
  const recapBtn    = $('recapBtn');
  const copyLink    = $('copyLink');

  // Stage & video
  const stage     = $('stage');
  const video     = $('video');
  const fx        = $('fx');
  const countdown = $('countdown');
  const toast     = $('toast');
  const empty     = $('empty');
  const emptyInner= $('emptyInner');
  const tapSync   = $('tapSync');
  const fsChat    = $('fsChat');
  const fsChatBar = $('fsChatBar');
  const fsChatInput = $('fsChatInput');
  const stageTray = $('stageTray');
  const voteCard  = $('voteCard');
  const heatStrip = $('heatStrip');

  // Controls
  const controls = $('controls');
  const playBtn  = $('playBtn');
  const timeNow  = $('timeNow');
  const seek     = $('seek');
  const timeTotal= $('timeTotal');
  const countBtn = $('countBtn');
  const trayBtn  = $('trayBtn');
  const ccBtn    = $('ccBtn');
  const ccInput  = $('ccInput');
  const pingBtn  = $('pingBtn');
  const muteVol  = $('muteVol');
  const vol      = $('vol');
  const fsBtn    = $('fsBtn');
  const lockNote = $('lockNote');

  // Reactions & users & chat
  const reactions   = $('reactions');
  const peopleCount = $('peopleCount');
  const userList    = $('userList');
  const voiceBtn    = $('voiceBtn');
  const muteBtn     = $('muteBtn');
  const messages    = $('messages');
  const chatForm    = $('chatForm');
  const chatInput   = $('chatInput');
  const flyToggle   = $('flyToggle');

  // Source dialog
  const sourceDialog = $('sourceDialog');
  const fileInput    = $('fileInput');
  const pickFile     = $('pickFile');
  const uploadBox    = $('uploadBox');
  const uploadFill   = $('uploadFill');
  const uploadText   = $('uploadText');
  const localInput   = $('localInput');
  const pickLocal    = $('pickLocal');
  const urlInput     = $('urlInput');
  const useUrl       = $('useUrl');
  const closeDialog  = $('closeDialog');

  // Recap dialog
  const recapDialog = $('recapDialog');
  const recapList   = $('recapList');
  const closeRecap  = $('closeRecap');

  const audioSink = $('audioSink');

  /* ---------- State ---------- */
  let socket          = null;
  let roomId          = null;
  let you             = null;   // { id, name, isHost }
  let isHost          = false;
  let canControl      = false;
  let currentControlMode = 'host';
  let currentMovie    = null;
  let currentUpload   = null;
  let localFile       = null;
  let joinedOnce      = false;
  let pendingSnapshotState = null;
  let isSeeking       = false;
  let toastTimer      = null;
  let idleTimer       = null;
  let pingMode        = false;
  let currentVote     = null;
  let voteTimer       = null;
  let currentHeat     = {};
  let subtitleOffset  = 0;      // seconds
  let subtitleBlobUrl = null;
  let isBuffering     = false;
  let bufferingTimer  = null;
  let peerVolumes     = new Map(); // userId -> 0..1
  let currentUsers    = [];

  // Playback sync state — server is source of truth
  let srv = { playing: false, time: 0, at: performance.now() };
  function target() {
    const now = performance.now();
    return srv.playing ? srv.time + (now - srv.at) / 1000 : srv.time;
  }

  // WebRTC
  let iceServers   = [{ urls: 'stun:stun.l.google.com:19302' }];
  let localStream  = null;
  let audioCtx     = null;
  let localAnalyser= null;
  let inVoice      = false;
  let isMuted      = false;
  const peers      = new Map(); // peerId -> { pc, audioEl, analyser, queuedCandidates, remoteDescSet }

  /* ---------- Helpers ---------- */
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function nameToColor(name) {
    let hash = 0;
    const str = String(name || '');
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function resetIdle() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stage.classList.add('idle'), 2500);
  }

  function isFocusedOnInput() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  /* ---------- Phase A: fullscreen chat overlay ---------- */
  const fsChatMessages = []; // last 4

  function pushFsChatMessage(text) {
    const el = document.createElement('div');
    el.className = 'fs-msg';
    el.textContent = text;
    fsChat.appendChild(el);
    fsChatMessages.push(el);
    if (fsChatMessages.length > 4) {
      const old = fsChatMessages.shift();
      old.remove();
    }
    // Fade out after 6s
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => { if (el.parentNode) el.remove(); const idx = fsChatMessages.indexOf(el); if (idx > -1) fsChatMessages.splice(idx, 1); }, 500);
    }, 6000);
  }

  fsChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const text = fsChatInput.value.trim();
      if (text && socket) {
        socket.emit('chat', { text, fly: false });
      }
      fsChatInput.value = '';
      fsChatBar.classList.add('hidden');
      fsChatInput.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fsChatBar.classList.add('hidden');
      fsChatInput.value = '';
      fsChatInput.blur();
    }
  });

  /* ---------- Phase A: reaction tray inside stage ---------- */
  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥', '💀', '🍿', '👀', '🥶'];

  function buildReactionButtons(container, includeVoteButtons) {
    container.textContent = '';
    REACTION_EMOJIS.forEach((em) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = em;
      btn.addEventListener('click', () => { if (socket) socket.emit('reaction', em); });
      container.appendChild(btn);
    });

    const sep = document.createElement('div');
    sep.className = 'sep';
    container.appendChild(sep);

    const pauseNudge = document.createElement('button');
    pauseNudge.type = 'button';
    pauseNudge.className = 'nudge';
    pauseNudge.textContent = '✋ Wait, pause!';
    pauseNudge.addEventListener('click', () => { if (socket) socket.emit('nudge', 'pause'); });
    container.appendChild(pauseNudge);

    const brbNudge = document.createElement('button');
    brbNudge.type = 'button';
    brbNudge.className = 'nudge';
    brbNudge.textContent = '🚽 BRB';
    brbNudge.addEventListener('click', () => { if (socket) socket.emit('nudge', 'brb'); });
    container.appendChild(brbNudge);

    if (includeVoteButtons) {
      const sep2 = document.createElement('div');
      sep2.className = 'sep';
      container.appendChild(sep2);

      const voteRewind = document.createElement('button');
      voteRewind.type = 'button';
      voteRewind.className = 'nudge';
      voteRewind.textContent = '⏪ Vote: rewind 10s';
      voteRewind.addEventListener('click', () => { if (socket) socket.emit('vote-start', { kind: 'rewind' }); });
      container.appendChild(voteRewind);

      const votePause = document.createElement('button');
      votePause.type = 'button';
      votePause.className = 'nudge';
      votePause.textContent = '⏸ Vote: pause';
      votePause.addEventListener('click', () => { if (socket) socket.emit('vote-start', { kind: 'pause' }); });
      container.appendChild(votePause);
    }
  }

  // Build external reactions bar (without vote buttons duplicated, include them here)
  buildReactionButtons(reactions, true);
  // Build stage tray (with vote buttons too — same set)
  buildReactionButtons(stageTray, true);

  trayBtn.addEventListener('click', () => {
    trayBtn.classList.toggle('on');
    stageTray.classList.toggle('hidden', !trayBtn.classList.contains('on'));
  });

  /* ---------- Phase B: Buffering detection ---------- */
  video.addEventListener('waiting', () => {
    clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(() => {
      if (!isBuffering) {
        isBuffering = true;
        if (socket) socket.emit('buffering', true);
      }
    }, 1000);
  });

  function clearBufferingState() {
    clearTimeout(bufferingTimer);
    if (isBuffering) {
      isBuffering = false;
      if (socket) socket.emit('buffering', false);
    }
  }

  video.addEventListener('playing', clearBufferingState);
  video.addEventListener('canplay', clearBufferingState);

  /* ---------- Phase B: Subtitles ---------- */
  let subtitleOriginalCues = null; // string of full VTT for re-offset

  function srtToVtt(raw) {
    // Strip BOM
    let text = raw.replace(/^\uFEFF/, '');
    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Replace comma decimal separator in SRT timestamps: 00:01:02,500 -> 00:01:02.500
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    // Remove sequence numbers (lines that are just digits between blank lines)
    text = text.replace(/^\d+\n/gm, '');
    return 'WEBVTT\n\n' + text.trim() + '\n';
  }

  async function decodeSubtitle(file) {
    const buf = await file.arrayBuffer();
    // Try UTF-8 first
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    // If replacement chars present, retry as windows-1252
    if (text.includes('\uFFFD')) {
      text = new TextDecoder('windows-1252', { fatal: false }).decode(buf);
    }
    return text;
  }

  function applySubtitleVtt(vttText) {
    // Remove old track
    const oldTrack = video.querySelector('track[data-wt-sub]');
    if (oldTrack) oldTrack.remove();
    if (subtitleBlobUrl) URL.revokeObjectURL(subtitleBlobUrl);

    const blob = new Blob([vttText], { type: 'text/vtt' });
    subtitleBlobUrl = URL.createObjectURL(blob);

    const track = document.createElement('track');
    track.setAttribute('data-wt-sub', '1');
    track.kind = 'subtitles';
    track.default = true;
    track.src = subtitleBlobUrl;
    video.appendChild(track);
    track.track.mode = 'showing';
  }

  function shiftVtt(vttText, offsetSec) {
    // Shift all timestamp lines: HH:MM:SS.mmm --> HH:MM:SS.mmm
    return vttText.replace(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g,
      (_, h, m, s, ms) => {
        let totalMs = (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms);
        totalMs = Math.max(0, totalMs + Math.round(offsetSec * 1000));
        const nh = Math.floor(totalMs / 3600000);
        const nm = Math.floor((totalMs % 3600000) / 60000);
        const ns = Math.floor((totalMs % 60000) / 1000);
        const nms = totalMs % 1000;
        return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}:${String(ns).padStart(2,'0')}.${String(nms).padStart(3,'0')}`;
      }
    );
  }

  ccBtn.addEventListener('click', () => ccInput.click());

  ccInput.addEventListener('change', async () => {
    const file = ccInput.files[0];
    if (!file) return;
    ccInput.value = '';
    subtitleOffset = 0;
    try {
      const raw = await decodeSubtitle(file);
      const vtt = srtToVtt(raw);
      subtitleOriginalCues = vtt;
      applySubtitleVtt(vtt);
      showToast('Subtitles loaded (offset: 0.0s)');
    } catch (err) {
      showToast('Could not load subtitle file');
    }
  });

  /* ---------- Permissions & UI state ---------- */
  function updatePermissions() {
    canControl = isHost || currentControlMode === 'all';
    controls.classList.toggle('locked', !canControl);
    lockNote.textContent = canControl ? '' : 'Only the host can control playback';

    document.querySelectorAll('.host-only').forEach((el) => {
      el.classList.toggle('hidden', !isHost);
    });
  }

  function renderEmptyState() {
    emptyInner.textContent = '';

    if (currentMovie) {
      if (currentMovie.kind === 'upload' || currentMovie.kind === 'url') {
        empty.classList.add('hidden');
        return;
      }
      if (currentMovie.kind === 'local') {
        if (localFile && localFile.name === currentMovie.name && localFile.size === currentMovie.size) {
          empty.classList.add('hidden');
          return;
        }
        empty.classList.remove('hidden');
        const big = document.createElement('div'); big.className = 'big'; big.textContent = '📁';
        const title = document.createElement('h3'); title.textContent = 'Local file needed';
        const p = document.createElement('p'); p.className = 'muted small';
        p.textContent = `Host selected "${currentMovie.name}" (${formatBytes(currentMovie.size)}). Pick the same file on your device to watch.`;
        const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = 'Choose local file…';
        btn.addEventListener('click', () => localInput.click());
        emptyInner.appendChild(big); emptyInner.appendChild(title);
        emptyInner.appendChild(p); emptyInner.appendChild(btn);
        return;
      }
    }

    empty.classList.remove('hidden');
    const big = document.createElement('div'); big.className = 'big';

    if (currentUpload) {
      big.textContent = '⏳';
      const p = document.createElement('p');
      const pct = Math.round((currentUpload.received / currentUpload.total) * 100);
      p.textContent = `Host is uploading "${currentUpload.name}" (${pct}%)…`;
      emptyInner.appendChild(big); emptyInner.appendChild(p);
      return;
    }

    big.textContent = '🍿';
    const p = document.createElement('p');
    if (isHost) {
      p.textContent = 'No movie is loaded yet.';
      const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = 'Choose a movie';
      btn.addEventListener('click', () => sourceDialog.showModal());
      emptyInner.appendChild(big); emptyInner.appendChild(p); emptyInner.appendChild(btn);
    } else {
      p.textContent = 'Waiting for the host to choose a movie…';
      emptyInner.appendChild(big); emptyInner.appendChild(p);
    }
  }

  function setMovie(m) {
    currentMovie = m;
    if (!m) {
      movieTitle.textContent = 'No movie yet';
      video.removeAttribute('src');
      video.load();
      renderEmptyState();
      return;
    }
    movieTitle.textContent = m.name;
    if (m.kind === 'upload' || m.kind === 'url') {
      if (video.getAttribute('data-src') !== m.url) {
        video.setAttribute('data-src', m.url);
        video.src = m.url;
        video.load();
      }
      renderEmptyState();
    } else if (m.kind === 'local') {
      video.removeAttribute('data-src');
      if (localFile && localFile.name === m.name && localFile.size === m.size) {
        video.src = URL.createObjectURL(localFile);
        video.load();
      } else {
        video.removeAttribute('src');
        video.load();
      }
      renderEmptyState();
    }
  }

  /* ---------- Phase B: Per-person voice volume ---------- */
  function renderUserList(users) {
    currentUsers = users;
    userList.textContent = '';
    peopleCount.textContent = `(${users.length})`;

    users.forEach((u) => {
      const li = document.createElement('li');
      li.id = `user-${u.id}`;

      const av = document.createElement('div');
      av.className = 'av';
      av.style.backgroundColor = nameToColor(u.name);
      av.textContent = (u.name || '?').trim().charAt(0).toUpperCase();

      const uname = document.createElement('div');
      uname.className = 'uname';
      uname.textContent = u.name + (you && u.id === you.id ? ' (you)' : '');

      const badges = document.createElement('div');
      badges.className = 'badges';
      let bText = '';
      if (u.isHost)     bText += '👑 ';
      if (u.buffering)  bText += '⏳ ';
      if (u.inVoice)    bText += u.muted ? '🔇 ' : '🎙️ ';
      badges.textContent = bText.trim();

      li.appendChild(av);
      li.appendChild(uname);
      li.appendChild(badges);

      // Per-person voice volume slider (only for other inVoice users)
      if (u.inVoice && you && u.id !== you.id) {
        const peer = peers.get(u.id);
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'peer-vol-wrap';
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0'; slider.max = '1'; slider.step = '0.05';
        // Restore saved volume (don't reset on re-render)
        slider.value = peerVolumes.has(u.id) ? String(peerVolumes.get(u.id)) : '1';
        slider.className = 'peer-vol';
        slider.title = `${u.name} volume`;
        slider.addEventListener('input', () => {
          const v = Number(slider.value);
          peerVolumes.set(u.id, v);
          if (peer && peer.audioEl) peer.audioEl.volume = v;
        });
        // Also apply any saved value to the peer audio element immediately
        if (peer && peer.audioEl && peerVolumes.has(u.id)) {
          peer.audioEl.volume = peerVolumes.get(u.id);
        }
        sliderWrap.appendChild(slider);
        li.appendChild(sliderWrap);
      }

      userList.appendChild(li);
    });
  }

  /* ---------- Phase A: appendChat with live flag ---------- */
  function appendChat(msg, live = true) {
    const el = document.createElement('div');
    el.className = msg.system ? 'msg system' : 'msg';

    if (msg.system) {
      const span = document.createElement('span');
      span.textContent = msg.text;
      el.appendChild(span);
    } else {
      const b = document.createElement('b');
      b.textContent = msg.name + ':';
      const span = document.createElement('span');
      span.textContent = ' ' + msg.text;
      el.appendChild(b);
      el.appendChild(span);

      // Phase A fix: only fly for live messages, not history replay
      if (msg.fly && live) {
        showFlyComment(msg.text);
      }

      // Push to fullscreen overlay for live messages
      if (live) {
        pushFsChatMessage((msg.name ? msg.name + ': ' : '') + msg.text);
      }
    }

    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function showFlyComment(text) {
    const el = document.createElement('div');
    el.className = 'flycomment';
    el.style.top = `${(Math.random() * 65 + 5).toFixed(1)}%`;
    el.textContent = text;
    fx.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function showFloater(emoji, name) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.style.setProperty('--dx', `${(Math.random() * 80 - 40).toFixed(0)}px`);
    el.style.left = `${(Math.random() * 70 + 15).toFixed(1)}%`;

    const e = document.createElement('div'); e.className = 'e'; e.textContent = emoji;
    const n = document.createElement('div'); n.className = 'n'; n.textContent = name;

    el.appendChild(e); el.appendChild(n);
    fx.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  /* ---------- Phase C: Heat Strip ---------- */
  function renderHeatStrip(heat) {
    heatStrip.textContent = '';
    if (!heat || !video.duration) return;

    const buckets = Object.entries(heat)
      .map(([k, v]) => ({ idx: Number(k), ...v }))
      .sort((a, b) => a.idx - b.idx);
    if (buckets.length === 0) return;

    const maxBucketIdx = Math.max(...buckets.map(b => b.idx));
    const totalBuckets = Math.max(maxBucketIdx + 1, Math.ceil(video.duration / 10));
    const maxN = Math.max(...buckets.map(b => b.n), 1);

    buckets.forEach((b) => {
      const pct = (b.idx / totalBuckets) * 100;
      const width = (1 / totalBuckets) * 100;
      const intensity = Math.min(1, b.n / maxN);
      const topEmoji = Object.entries(b.e || {}).sort((a, z) => z[1] - a[1])[0];

      const seg = document.createElement('div');
      seg.className = 'heat-seg';
      seg.style.left = `${pct}%`;
      seg.style.width = `${width}%`;
      seg.style.opacity = String(0.3 + intensity * 0.7);
      seg.style.backgroundColor = `hsl(${40 - intensity * 40}, 100%, 55%)`;
      seg.title = `${formatTime(b.idx * 10)} · ${b.n} reaction${b.n !== 1 ? 's' : ''}${topEmoji ? ' · ' + topEmoji[0] : ''}`;
      heatStrip.appendChild(seg);
    });
  }

  /* ---------- Phase C: Recap dialog ---------- */
  function openRecap() {
    recapList.textContent = '';
    const heat = currentHeat;
    if (!heat || Object.keys(heat).length === 0) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No reactions yet.';
      recapList.appendChild(p);
      recapDialog.showModal();
      return;
    }

    const sorted = Object.entries(heat)
      .map(([k, v]) => ({ idx: Number(k), ...v }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);

    sorted.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'recap-row';
      const topEmoji = Object.entries(b.e || {}).sort((a, z) => z[1] - a[1])[0];

      const timeEl = document.createElement('span');
      timeEl.textContent = formatTime(b.idx * 10);
      timeEl.className = 'recap-time';

      const em = document.createElement('span');
      em.textContent = topEmoji ? topEmoji[0] : '❤️';

      const count = document.createElement('span');
      count.textContent = `× ${b.n}`;
      count.className = 'muted small';

      row.appendChild(timeEl);
      row.appendChild(em);
      row.appendChild(count);

      if (canControl) {
        row.style.cursor = 'pointer';
        row.title = 'Click to seek here';
        row.addEventListener('click', () => {
          if (socket && canControl) {
            socket.emit('control', { action: 'seek', time: b.idx * 10 });
            recapDialog.close();
          }
        });
      }
      recapList.appendChild(row);
    });

    recapDialog.showModal();
  }

  recapBtn.addEventListener('click', openRecap);
  closeRecap.addEventListener('click', () => recapDialog.close());

  /* ---------- Phase C: Vote card ---------- */
  function renderVoteCard(vote) {
    currentVote = vote;
    clearTimeout(voteTimer);
    voteCard.textContent = '';

    if (!vote || vote.status !== 'open') {
      voteCard.classList.add('hidden');
      return;
    }

    voteCard.classList.remove('hidden');

    const label = document.createElement('div');
    label.className = 'vote-label';
    const kindText = vote.kind === 'rewind' ? 'rewind 10s' : 'pause';
    label.textContent = `${vote.by} wants to ${kindText}`;

    const info = document.createElement('div');
    info.className = 'vote-info muted small';
    const secsLeft = Math.max(0, Math.round((vote.endsAt - Date.now()) / 1000));
    info.textContent = `${vote.yes}/${vote.needed} yes · ${secsLeft}s left`;

    const yesBtn = document.createElement('button');
    yesBtn.className = 'primary';
    yesBtn.textContent = '✅ Yes';
    yesBtn.addEventListener('click', () => { if (socket) socket.emit('vote-yes'); });

    voteCard.appendChild(label);
    voteCard.appendChild(info);
    voteCard.appendChild(yesBtn);

    // Countdown label update
    voteTimer = setInterval(() => {
      const s = Math.max(0, Math.round((vote.endsAt - Date.now()) / 1000));
      info.textContent = `${vote.yes}/${vote.needed} yes · ${s}s left`;
      if (s <= 0) clearInterval(voteTimer);
    }, 1000);
  }

  /* ---------- Phase C: Ping (point at screen) ---------- */
  pingBtn.addEventListener('click', () => {
    pingMode = !pingMode;
    pingBtn.classList.toggle('on', pingMode);
    stage.style.cursor = pingMode ? 'crosshair' : '';
  });

  stage.addEventListener('click', (e) => {
    if (!pingMode || !socket) return;
    const rect = video.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    socket.emit('ping', { x, y });
  });

  function showPing(x, y, name) {
    const rect = video.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'ping-dot';
    // Position relative to #stage, calculated from video rect inside stage
    const px = (video.offsetLeft + x * video.offsetWidth);
    const py = (video.offsetTop + y * video.offsetHeight);
    dot.style.left = `${px}px`;
    dot.style.top = `${py}px`;

    const label = document.createElement('span');
    label.className = 'ping-name';
    label.textContent = name;
    dot.appendChild(label);
    fx.appendChild(dot);
    setTimeout(() => dot.remove(), 2500);
  }

  /* ---------- Playback Core ---------- */
  function applyHard() {
    const t = target();
    const diff = Math.abs(video.currentTime - t);
    const threshold = srv.playing ? 0.4 : 0.05;
    if (diff > threshold) video.currentTime = Math.max(0, t);
    video.playbackRate = 1;

    if (srv.playing) {
      const p = video.play();
      if (p !== undefined) {
        p.then(() => { tapSync.hidden = true; })
         .catch(() => { tapSync.hidden = false; });
      }
    } else {
      video.pause();
    }
  }

  video.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(video.duration);
    renderHeatStrip(currentHeat);
    if (pendingSnapshotState) {
      srv = { playing: pendingSnapshotState.playing, time: pendingSnapshotState.time, at: performance.now() };
      pendingSnapshotState = null;
      applyHard();
    }
  });

  video.addEventListener('timeupdate', () => {
    if (!isSeeking && video.duration) {
      seek.value = (video.currentTime / video.duration) * 1000;
      timeNow.textContent = formatTime(video.currentTime);
    }
  });

  video.addEventListener('play', () => { stage.classList.remove('paused'); tapSync.hidden = true; });
  video.addEventListener('pause', () => stage.classList.add('paused'));

  video.addEventListener('ended', () => {
    if (canControl) socket.emit('control', { action: 'pause', time: video.duration || video.currentTime });
    openRecap();
  });

  video.addEventListener('error', () => showToast("Can't play this file. Use MP4 with H.264 + AAC."));

  // Controls handlers — emit only from UI; never from video events
  playBtn.addEventListener('click', () => {
    if (!canControl || !currentMovie) return;
    if (srv.playing) socket.emit('control', { action: 'pause', time: video.currentTime });
    else socket.emit('control', { action: 'play', time: video.currentTime });
  });

  countBtn.addEventListener('click', () => {
    if (!canControl || !currentMovie) return;
    socket.emit('countdown');
  });

  seek.addEventListener('input', () => {
    isSeeking = true;
    if (video.duration) timeNow.textContent = formatTime((seek.value / 1000) * video.duration);
  });

  seek.addEventListener('change', () => {
    isSeeking = false;
    if (!canControl || !currentMovie || !video.duration) return;
    socket.emit('control', { action: 'seek', time: (seek.value / 1000) * video.duration });
  });

  tapSync.addEventListener('click', () => { tapSync.hidden = true; applyHard(); });

  function toggleMute() { video.muted = !video.muted; updateMuteIcon(); }
  function updateMuteIcon() { muteVol.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊'; }

  muteVol.addEventListener('click', toggleMute);
  vol.addEventListener('input', () => { video.volume = Number(vol.value); video.muted = (video.volume === 0); updateMuteIcon(); });

  function toggleFullscreen() {
    if (!document.fullscreenElement) stage.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }
  fsBtn.addEventListener('click', toggleFullscreen);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Block if any input (including the FS chat input) is focused
    if (isFocusedOnInput()) return;

    if (e.key === 'Enter') {
      // Open fullscreen chat input
      if (document.fullscreenElement) {
        e.preventDefault();
        fsChatBar.classList.remove('hidden');
        fsChatInput.focus();
      }
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (canControl && currentMovie) {
        if (srv.playing) socket.emit('control', { action: 'pause', time: video.currentTime });
        else socket.emit('control', { action: 'play', time: video.currentTime });
      }
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (canControl && currentMovie && video.duration) {
        socket.emit('control', { action: 'seek', time: Math.max(0, video.currentTime - 10) });
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (canControl && currentMovie && video.duration) {
        socket.emit('control', { action: 'seek', time: Math.min(video.duration, video.currentTime + 10) });
      }
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault(); toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault(); toggleMute();
    } else if ((e.key === ',' || e.key === '.') && subtitleOriginalCues) {
      // Phase B: subtitle offset shift
      e.preventDefault();
      subtitleOffset += e.key === ',' ? -0.5 : 0.5;
      const shifted = shiftVtt(subtitleOriginalCues, subtitleOffset);
      applySubtitleVtt(shifted);
      showToast(`Subtitle offset: ${subtitleOffset >= 0 ? '+' : ''}${subtitleOffset.toFixed(1)}s`);
    }
  });

  // Stage idle
  stage.addEventListener('mousemove', resetIdle);
  stage.addEventListener('mousedown', resetIdle);
  stage.addEventListener('touchstart', resetIdle, { passive: true });

  /* ---------- Chat form ---------- */
  flyToggle.addEventListener('click', () => flyToggle.classList.toggle('on'));

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !socket) return;
    socket.emit('chat', { text, fly: flyToggle.classList.contains('on') });
    chatInput.value = '';
  });

  /* ---------- Movie sources & dialog ---------- */
  changeMovie.addEventListener('click', () => sourceDialog.showModal());
  closeDialog.addEventListener('click', () => sourceDialog.close());

  copyLink.addEventListener('click', async () => {
    const url = `${window.location.origin}/r/${roomId}`;
    try { await navigator.clipboard.writeText(url); showToast('Invite link copied!'); }
    catch { prompt('Copy invite link:', url); }
  });

  controlMode.addEventListener('change', () => {
    if (!isHost || !socket) return;
    socket.emit('control-mode', controlMode.value);
  });

  waitModeChk.addEventListener('change', () => {
    if (!isHost || !socket) return;
    socket.emit('wait-mode', waitModeChk.checked);
  });

  useUrl.addEventListener('click', () => {
    const u = urlInput.value.trim();
    if (!u || !socket || !isHost) return;
    socket.emit('set-url', { url: u });
    urlInput.value = '';
    sourceDialog.close();
  });

  pickLocal.addEventListener('click', () => localInput.click());

  localInput.addEventListener('change', () => {
    const file = localInput.files[0];
    if (!file) return;
    localFile = file;
    localInput.value = '';
    if (isHost && socket) { socket.emit('set-local', { name: file.name, size: file.size }); sourceDialog.close(); }
    else if (currentMovie && currentMovie.kind === 'local') {
      if (file.name === currentMovie.name && file.size === currentMovie.size) setMovie(currentMovie);
      else showToast(`Selected file doesn't match "${currentMovie.name}" (${formatBytes(currentMovie.size)})`);
    }
  });

  pickFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !isHost) return;
    fileInput.value = '';
    startChunkedUpload(file);
  });

  /* Chunked upload */
  async function uploadChunk(chunk, offset, total, name, hostToken, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/rooms/${roomId}/upload?offset=${offset}&total=${total}&name=${encodeURIComponent(name)}`);
      xhr.setRequestHeader('x-host-token', hostToken);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
      xhr.onload = () => {
        let json = null;
        try { json = JSON.parse(xhr.responseText); } catch {}
        resolve({ status: xhr.status, data: json });
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(chunk);
    });
  }

  async function startChunkedUpload(file) {
    const hostToken = localStorage.getItem(`wt_host_${roomId}`);
    if (!hostToken) { showToast('Host token missing'); return; }

    uploadBox.classList.remove('hidden');
    uploadFill.style.width = '0%';
    uploadText.textContent = 'Starting upload…';
    pickFile.disabled = true;

    const CHUNK_SIZE = 4 * 1024 * 1024;
    let offset = 0;
    const total = file.size;
    const name = file.name;
    const startTime = performance.now();
    let retries = 0;

    while (offset < total) {
      const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, total));
      const updateProgress = (loaded) => {
        const bytes = Math.min(total, offset + loaded);
        const elapsed = (performance.now() - startTime) / 1000;
        const mbps = elapsed > 0.1 ? ((bytes / 1048576) / elapsed).toFixed(1) : '0.0';
        const pct = Math.min(100, Math.round((bytes / total) * 100));
        uploadFill.style.width = `${pct}%`;
        uploadText.textContent = `${pct}% · ${mbps} MB/s · ${(bytes / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
      };
      try {
        const res = await uploadChunk(chunk, offset, total, name, hostToken, updateProgress);
        if (res.status === 200) { retries = 0; offset = res.data.received; if (res.data.done) break; }
        else if (res.status === 409) { retries = 0; offset = res.data.received; }
        else if (res.status >= 400 && res.status < 500) {
          const err = res.data?.error || `Upload failed (${res.status})`;
          uploadText.textContent = err; showToast(err); pickFile.disabled = false; return;
        } else throw new Error(`Server ${res.status}`);
      } catch {
        retries++;
        if (retries > 6) { uploadText.textContent = 'Upload failed after retries.'; showToast('Upload lost'); pickFile.disabled = false; return; }
        const delay = Math.min(1000 * 2 ** retries, 10000);
        uploadText.textContent = `Retrying in ${(delay/1000).toFixed(0)}s…`;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    uploadFill.style.width = '100%';
    uploadText.textContent = 'Upload complete!';
    pickFile.disabled = false;
    setTimeout(() => { uploadBox.classList.add('hidden'); sourceDialog.close(); }, 1000);
  }

  /* ---------- WebRTC Audio Mesh ---------- */
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) { const cfg = await res.json(); if (cfg.iceServers) iceServers = cfg.iceServers; }
    } catch {}
  }

  function removePeer(peerId) {
    const p = peers.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch {}
    if (p.audioEl) { p.audioEl.srcObject = null; p.audioEl.remove(); }
    peers.delete(peerId);
  }

  function createPeerConnection(peerId, isInitiator) {
    if (peers.has(peerId)) removePeer(peerId);
    const pc = new RTCPeerConnection({ iceServers });
    const peerObj = { pc, audioEl: null, analyser: null, queuedCandidates: [], remoteDescSet: false };
    peers.set(peerId, peerObj);

    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = (ev) => {
      if (ev.candidate && socket) socket.emit('signal', { to: peerId, data: { type: 'candidate', candidate: ev.candidate } });
    };

    pc.ontrack = (ev) => {
      const remoteStream = ev.streams[0] || new MediaStream([ev.track]);
      if (!peerObj.audioEl) {
        peerObj.audioEl = document.createElement('audio');
        peerObj.audioEl.autoplay = true;
        audioSink.appendChild(peerObj.audioEl);
      }
      peerObj.audioEl.srcObject = remoteStream;
      // Apply saved volume
      if (peerVolumes.has(peerId)) peerObj.audioEl.volume = peerVolumes.get(peerId);

      if (audioCtx) {
        try {
          const source = audioCtx.createMediaStreamSource(remoteStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          peerObj.analyser = analyser;
        } catch {}
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(peerId);
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (socket) socket.emit('signal', { to: peerId, data: { type: 'offer', sdp: pc.localDescription } });
        } catch (e) { console.error('Offer error:', e); }
      };
    }
    return peerObj;
  }

  async function joinVoice() {
    await fetchConfig();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      showToast('Microphone blocked or not available.');
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(localStream);
      localAnalyser = audioCtx.createAnalyser();
      localAnalyser.fftSize = 256;
      source.connect(localAnalyser);
    } catch {}

    socket.emit('voice-join', null, (peerIds) => {
      inVoice = true; isMuted = false;
      voiceBtn.textContent = '🚪 Leave voice';
      voiceBtn.classList.add('live');
      muteBtn.classList.remove('hidden');
      muteBtn.classList.remove('live');
      muteBtn.textContent = 'Mute mic';
      if (Array.isArray(peerIds)) peerIds.forEach(pid => createPeerConnection(pid, true));
    });
  }

  function leaveVoice(quiet = false) {
    if (!inVoice && !localStream) return;
    inVoice = false;
    if (!quiet && socket) socket.emit('voice-leave');
    for (const pid of [...peers.keys()]) removePeer(pid);
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    localAnalyser = null;
    voiceBtn.textContent = '🎙 Join voice';
    voiceBtn.classList.remove('live');
    muteBtn.classList.add('hidden');
    muteBtn.classList.remove('live');
    muteBtn.textContent = 'Mute mic';
    isMuted = false;
  }

  voiceBtn.addEventListener('click', () => { if (inVoice) leaveVoice(); else joinVoice(); });

  muteBtn.addEventListener('click', () => {
    if (!inVoice || !localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    muteBtn.textContent = isMuted ? 'Unmute mic' : 'Mute mic';
    muteBtn.classList.toggle('live', isMuted);
    socket.emit('voice-mute', isMuted);
  });

  function isSpeaking(analyser) {
    if (!analyser) return false;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return (sum / data.length) > 16;
  }

  setInterval(() => {
    if (inVoice && localAnalyser && !isMuted) {
      const sp = isSpeaking(localAnalyser);
      if (you) { const li = document.getElementById(`user-${you.id}`); if (li) li.classList.toggle('speaking', sp); }
    } else if (you) {
      const li = document.getElementById(`user-${you.id}`); if (li) li.classList.remove('speaking');
    }
    for (const [peerId, pObj] of peers.entries()) {
      const sp = pObj.analyser ? isSpeaking(pObj.analyser) : false;
      const li = document.getElementById(`user-${peerId}`);
      if (li) li.classList.toggle('speaking', sp);
    }
  }, 120);

  /* ---------- Socket.IO Room Wiring ---------- */
  function connectSocket(userName, hostToken) {
    socket = io(); // eslint-disable-line no-undef

    function doJoin() {
      socket.emit('join', { roomId, name: userName, hostToken }, (res) => {
        if (!res || !res.ok) { joinError.textContent = (res && res.error) || 'Failed to join room'; return; }

        you    = res.you;
        isHost = you.isHost;
        joinedOnce = true;

        landingScreen.classList.add('hidden');
        joinScreen.classList.add('hidden');
        roomScreen.classList.remove('hidden');

        currentControlMode = res.room.controlMode || 'host';
        controlMode.value  = currentControlMode;
        waitModeChk.checked = !!res.room.waitMode;
        updatePermissions();

        renderUserList(res.room.users || []);

        messages.textContent = '';
        // Phase A fix: pass live=false for history replay
        if (Array.isArray(res.room.chat)) {
          res.room.chat.forEach((m) => appendChat(m, false));
        }

        currentUpload = res.room.upload;
        currentHeat   = res.room.heat || {};
        setMovie(res.room.movie);
        renderVoteCard(res.room.vote);

        if (res.room.state) {
          srv = { playing: res.room.state.playing, time: res.room.state.time, at: performance.now() };
          playBtn.textContent = srv.playing ? '⏸' : '▶';
          stage.classList.toggle('paused', !srv.playing);
          if (video.readyState >= 1) applyHard();
          else pendingSnapshotState = res.room.state;
        }
      });
    }

    socket.on('connect', () => {
      if (joinedOnce) { leaveVoice(true); showToast('Reconnected to room'); }
      doJoin();
    });

    socket.on('users', (users) => {
      renderUserList(users);
      const voiceIds = new Set(users.filter(u => u.inVoice).map(u => u.id));
      for (const [peerId] of peers.entries()) {
        if (!voiceIds.has(peerId)) removePeer(peerId);
      }
    });

    socket.on('movie', (m) => { currentUpload = null; currentHeat = {}; setMovie(m); if (m) showToast(`Movie loaded: ${m.name}`); });
    socket.on('upload', (u) => { currentUpload = u; renderEmptyState(); });

    socket.on('state', (msg) => {
      srv = { playing: msg.playing, time: msg.time, at: performance.now() };
      playBtn.textContent = srv.playing ? '⏸' : '▶';
      stage.classList.toggle('paused', !srv.playing);
      if (video.readyState >= 1) applyHard();
      if (msg.by && you && msg.by !== you.name) {
        if (msg.action === 'play') showToast(`${msg.by} played`);
        else if (msg.action === 'pause') showToast(`${msg.by} paused`);
        else if (msg.action === 'seek') showToast(`${msg.by} jumped to ${formatTime(msg.time)}`);
        else if (msg.action === 'auto-pause') showToast(`⏸ Auto-paused (buffering)`);
      }
    });

    socket.on('sync', (data) => {
      if (video.readyState < 3) return;
      srv = { playing: data.playing, time: data.time, at: performance.now() };
      if (video.paused && srv.playing) { applyHard(); return; }
      const drift = video.currentTime - target();
      if (Math.abs(drift) > 1.5) { video.currentTime = Math.max(0, target()); video.playbackRate = 1; }
      else if (drift > 0.35) video.playbackRate = 0.95;
      else if (drift < -0.35) video.playbackRate = 1.05;
      else video.playbackRate = 1;
    });

    socket.on('countdown', ({ n }) => {
      if (n > 0) {
        countdown.textContent = n;
        countdown.classList.remove('pop'); void countdown.offsetWidth; countdown.classList.add('pop');
      } else if (n === 0) {
        countdown.textContent = 'GO!';
        countdown.classList.remove('pop'); void countdown.offsetWidth; countdown.classList.add('pop');
        setTimeout(() => { if (countdown.textContent === 'GO!') countdown.textContent = ''; }, 900);
      } else {
        countdown.textContent = ''; countdown.classList.remove('pop');
      }
    });

    socket.on('control-mode', (mode) => { currentControlMode = mode; controlMode.value = mode; updatePermissions(); });
    socket.on('wait-mode', (val) => { waitModeChk.checked = val; });

    socket.on('chat', (msg) => appendChat(msg, true));

    socket.on('reaction', ({ emoji, name, t }) => {
      showFloater(emoji, name);
      // Update heat strip live
      if (Number.isFinite(t)) {
        const idx = Math.floor(t / 10);
        if (!currentHeat[idx]) currentHeat[idx] = { n: 0, e: {} };
        currentHeat[idx].n += 1;
        currentHeat[idx].e[emoji] = (currentHeat[idx].e[emoji] || 0) + 1;
        renderHeatStrip(currentHeat);
      }
    });

    socket.on('nudge', ({ kind, name }) => {
      if (kind === 'pause') showToast(`${name}: ✋ Wait, pause!`);
      else if (kind === 'brb') showToast(`${name}: 🚽 BRB`);
    });

    socket.on('vote', (vote) => renderVoteCard(vote));

    socket.on('ping', ({ x, y, name }) => showPing(x, y, name));

    socket.on('signal', async ({ from, data }) => {
      if (!inVoice || !data) return;
      if (data.type === 'offer') {
        let p = peers.get(from);
        if (!p) p = createPeerConnection(from, false);
        try {
          await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          p.remoteDescSet = true;
          while (p.queuedCandidates.length) await p.pc.addIceCandidate(new RTCIceCandidate(p.queuedCandidates.shift())).catch(() => {});
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { type: 'answer', sdp: p.pc.localDescription } });
        } catch (e) { console.error('WebRTC offer error:', e); }
      } else if (data.type === 'answer') {
        const p = peers.get(from);
        if (p) {
          try {
            await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            p.remoteDescSet = true;
            while (p.queuedCandidates.length) await p.pc.addIceCandidate(new RTCIceCandidate(p.queuedCandidates.shift())).catch(() => {});
          } catch (e) { console.error('WebRTC answer error:', e); }
        }
      } else if (data.type === 'candidate') {
        const p = peers.get(from);
        if (p) {
          if (p.remoteDescSet && p.pc.remoteDescription) p.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
          else p.queuedCandidates.push(data.candidate);
        }
      }
    });
  }

  /* ---------- Routing & init ---------- */
  async function init() {
    const pathMatch = window.location.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)/);

    if (pathMatch) {
      roomId = pathMatch[1].toLowerCase();
      try {
        const res = await fetch(`/api/rooms/${roomId}`);
        const data = await res.json();
        if (!data || !data.exists) {
          joinScreen.classList.remove('hidden');
          joinCode.textContent = roomId;
          joinError.textContent = 'Room does not exist or has expired.';
          enterBtn.disabled = true;
          return;
        }
      } catch {
        joinScreen.classList.remove('hidden');
        joinError.textContent = 'Could not check room status.';
        return;
      }

      joinCode.textContent = roomId;
      joinName.value = localStorage.getItem('wt_name') || '';
      joinScreen.classList.remove('hidden');

      const enterRoom = () => {
        const name = (joinName.value || '').trim() || 'Guest';
        localStorage.setItem('wt_name', name);
        const hostToken = localStorage.getItem(`wt_host_${roomId}`) || undefined;
        joinScreen.classList.add('hidden');
        connectSocket(name, hostToken);
      };

      enterBtn.addEventListener('click', enterRoom);
      joinName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enterRoom(); } });
    } else {
      landingScreen.classList.remove('hidden');
      landingName.value = localStorage.getItem('wt_name') || '';

      const handleCreate = async () => {
        createBtn.disabled = true;
        const name = (landingName.value || '').trim() || 'Host';
        localStorage.setItem('wt_name', name);
        try {
          const res = await fetch('/api/rooms', { method: 'POST' });
          if (!res.ok) throw new Error('Failed to create room');
          const data = await res.json();
          localStorage.setItem(`wt_host_${data.id}`, data.hostToken);
          window.location.href = `/r/${data.id}`;
        } catch (err) {
          alert('Could not create room: ' + err.message);
          createBtn.disabled = false;
        }
      };

      createBtn.addEventListener('click', handleCreate);
      landingName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } });
    }
  }

  init();
})();
