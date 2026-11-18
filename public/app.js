'use strict';

(() => {
  /* ---------- DOM elements ---------- */
  const $ = (id) => document.getElementById(id);

  // Screens
  const landingScreen = $('landing');
  const landingName = $('landingName');
  const createBtn = $('createBtn');

  const joinScreen = $('join');
  const joinCode = $('joinCode');
  const joinHint = $('joinHint');
  const joinName = $('joinName');
  const enterBtn = $('enterBtn');
  const joinError = $('joinError');

  const roomScreen = $('room');
  const movieTitle = $('movieTitle');
  const controlMode = $('controlMode');
  const changeMovie = $('changeMovie');
  const copyLink = $('copyLink');

  // Stage & video
  const stage = $('stage');
  const video = $('video');
  const fx = $('fx');
  const countdown = $('countdown');
  const toast = $('toast');
  const empty = $('empty');
  const emptyInner = $('emptyInner');
  const tapSync = $('tapSync');

  // Controls
  const controls = $('controls');
  const playBtn = $('playBtn');
  const timeNow = $('timeNow');
  const seek = $('seek');
  const timeTotal = $('timeTotal');
  const countBtn = $('countBtn');
  const muteVol = $('muteVol');
  const vol = $('vol');
  const fsBtn = $('fsBtn');
  const lockNote = $('lockNote');

  // Reactions & chat & users
  const reactions = $('reactions');
  const peopleCount = $('peopleCount');
  const userList = $('userList');
  const voiceBtn = $('voiceBtn');
  const muteBtn = $('muteBtn');
  const messages = $('messages');
  const chatForm = $('chatForm');
  const chatInput = $('chatInput');
  const flyToggle = $('flyToggle');

  // Dialog & sources
  const sourceDialog = $('sourceDialog');
  const fileInput = $('fileInput');
  const pickFile = $('pickFile');
  const uploadBox = $('uploadBox');
  const uploadFill = $('uploadFill');
  const uploadText = $('uploadText');
  const localInput = $('localInput');
  const pickLocal = $('pickLocal');
  const urlInput = $('urlInput');
  const useUrl = $('useUrl');
  const closeDialog = $('closeDialog');
  const audioSink = $('audioSink');

  /* ---------- State ---------- */
  let socket = null;
  let roomId = null;
  let you = null; // { id, name, isHost }
  let isHost = false;
  let canControl = false;
  let currentControlMode = 'host';
  let currentMovie = null; // { kind, name, size, url }
  let currentUpload = null;
  let localFile = null;
  let joinedOnce = false;
  let pendingSnapshotState = null;
  let isSeeking = false;
  let toastTimer = null;
  let idleTimer = null;

  // Playback sync state
  let srv = { playing: false, time: 0, at: performance.now() };
  function target() {
    const now = performance.now();
    return srv.playing ? srv.time + (now - srv.at) / 1000 : srv.time;
  }

  // WebRTC state
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let localStream = null;
  let audioCtx = null;
  let localAnalyser = null;
  let inVoice = false;
  let isMuted = false;
  const peers = new Map(); // peerId -> { pc, audioEl, analyser, queuedCandidates: [], remoteDescSet: bool }

  /* ---------- Helpers ---------- */
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
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
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function resetIdle() {
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stage.classList.add('idle');
    }, 2500);
  }

  /* ---------- UI Updates ---------- */
  function updatePermissions() {
    canControl = isHost || currentControlMode === 'all';
    controls.classList.toggle('locked', !canControl);
    lockNote.textContent = canControl ? '' : 'Only the host can control playback';

    const hostElements = document.querySelectorAll('.host-only');
    hostElements.forEach((el) => {
      if (isHost) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  }

  function renderEmptyState() {
    // Clear inner content securely
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
        // Need to pick local file
        empty.classList.remove('hidden');
        const big = document.createElement('div');
        big.className = 'big';
        big.textContent = '📁';
        const title = document.createElement('h3');
        title.textContent = 'Local file needed';
        const p = document.createElement('p');
        p.className = 'muted small';
        p.textContent = `Host selected "${currentMovie.name}" (${formatBytes(currentMovie.size)}). Pick the same file on your device to watch.`;
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = 'Choose local file…';
        btn.addEventListener('click', () => {
          localInput.click();
        });
        emptyInner.appendChild(big);
        emptyInner.appendChild(title);
        emptyInner.appendChild(p);
        emptyInner.appendChild(btn);
        return;
      }
    }

    // No movie
    empty.classList.remove('hidden');
    const big = document.createElement('div');
    big.className = 'big';

    if (currentUpload) {
      big.textContent = '⏳';
      const p = document.createElement('p');
      const pct = Math.round((currentUpload.received / currentUpload.total) * 100);
      p.textContent = `Host is uploading "${currentUpload.name}" (${pct}%)…`;
      emptyInner.appendChild(big);
      emptyInner.appendChild(p);
      return;
    }

    big.textContent = '🍿';
    const p = document.createElement('p');
    if (isHost) {
      p.textContent = 'No movie is loaded yet.';
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Choose a movie';
      btn.addEventListener('click', () => {
        sourceDialog.showModal();
      });
      emptyInner.appendChild(big);
      emptyInner.appendChild(p);
      emptyInner.appendChild(btn);
    } else {
      p.textContent = 'Waiting for the host to choose a movie…';
      emptyInner.appendChild(big);
      emptyInner.appendChild(p);
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

  function renderUserList(users) {
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
      if (u.isHost) bText += '👑 ';
      if (u.inVoice) bText += u.muted ? '🔇 ' : '🎙️ ';
      badges.textContent = bText.trim();

      li.appendChild(av);
      li.appendChild(uname);
      li.appendChild(badges);
      userList.appendChild(li);
    });
  }

  function appendChat(msg) {
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

      if (msg.fly) {
        showFlyComment(msg.text);
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

    const e = document.createElement('div');
    e.className = 'e';
    e.textContent = emoji;

    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = name;

    el.appendChild(e);
    el.appendChild(n);
    fx.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  /* ---------- Playback Core ---------- */
  function applyHard() {
    const t = target();
    const diff = Math.abs(video.currentTime - t);
    const threshold = srv.playing ? 0.4 : 0.05;

    if (diff > threshold) {
      video.currentTime = Math.max(0, t);
    }
    video.playbackRate = 1;

    if (srv.playing) {
      const p = video.play();
      if (p !== undefined) {
        p.then(() => {
          tapSync.hidden = true;
        }).catch((err) => {
          console.warn('Playback error / autoplay blocked:', err);
          tapSync.hidden = false;
        });
      }
    } else {
      video.pause();
    }
  }

  video.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(video.duration);
    if (pendingSnapshotState) {
      srv = {
        playing: pendingSnapshotState.playing,
        time: pendingSnapshotState.time,
        at: performance.now(),
      };
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

  video.addEventListener('play', () => {
    stage.classList.remove('paused');
    tapSync.hidden = true;
  });

  video.addEventListener('pause', () => {
    stage.classList.add('paused');
  });

  video.addEventListener('ended', () => {
    if (canControl) {
      socket.emit('control', { action: 'pause', time: video.duration || video.currentTime });
    }
  });

  video.addEventListener('error', () => {
    showToast("Can't play this file. Use MP4 with H.264 + AAC.");
  });

  // Controls UI handlers
  playBtn.addEventListener('click', () => {
    if (!canControl || !currentMovie) return;
    if (srv.playing) {
      socket.emit('control', { action: 'pause', time: video.currentTime });
    } else {
      socket.emit('control', { action: 'play', time: video.currentTime });
    }
  });

  countBtn.addEventListener('click', () => {
    if (!canControl || !currentMovie) return;
    socket.emit('countdown');
  });

  seek.addEventListener('input', () => {
    isSeeking = true;
    if (video.duration) {
      const previewTime = (seek.value / 1000) * video.duration;
      timeNow.textContent = formatTime(previewTime);
    }
  });

  seek.addEventListener('change', () => {
    isSeeking = false;
    if (!canControl || !currentMovie || !video.duration) return;
    const t = (seek.value / 1000) * video.duration;
    socket.emit('control', { action: 'seek', time: t });
  });

  tapSync.addEventListener('click', () => {
    tapSync.hidden = true;
    applyHard();
  });

  function toggleMute() {
    video.muted = !video.muted;
    updateMuteIcon();
  }

  function updateMuteIcon() {
    muteVol.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
  }

  muteVol.addEventListener('click', toggleMute);

  vol.addEventListener('input', () => {
    video.volume = Number(vol.value);
    video.muted = (video.volume === 0);
    updateMuteIcon();
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      stage.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  fsBtn.addEventListener('click', toggleFullscreen);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
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
        const t = Math.max(0, video.currentTime - 10);
        socket.emit('control', { action: 'seek', time: t });
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (canControl && currentMovie && video.duration) {
        const t = Math.min(video.duration, video.currentTime + 10);
        socket.emit('control', { action: 'seek', time: t });
      }
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
    }
  });

  // Stage idle tracking
  stage.addEventListener('mousemove', resetIdle);
  stage.addEventListener('mousedown', resetIdle);
  stage.addEventListener('touchstart', resetIdle, { passive: true });

  /* ---------- Reactions & Nudges ---------- */
  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥', '💀', '🍿', '👀', '🥶'];
  REACTION_EMOJIS.forEach((em) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      if (socket) socket.emit('reaction', em);
    });
    reactions.appendChild(btn);
  });

  const sep = document.createElement('div');
  sep.className = 'sep';
  reactions.appendChild(sep);

  const pauseNudgeBtn = document.createElement('button');
  pauseNudgeBtn.type = 'button';
  pauseNudgeBtn.className = 'nudge';
  pauseNudgeBtn.textContent = '✋ Wait, pause!';
  pauseNudgeBtn.addEventListener('click', () => {
    if (socket) socket.emit('nudge', 'pause');
  });
  reactions.appendChild(pauseNudgeBtn);

  const brbNudgeBtn = document.createElement('button');
  brbNudgeBtn.type = 'button';
  brbNudgeBtn.className = 'nudge';
  brbNudgeBtn.textContent = '🚽 BRB';
  brbNudgeBtn.addEventListener('click', () => {
    if (socket) socket.emit('nudge', 'brb');
  });
  reactions.appendChild(brbNudgeBtn);

  /* ---------- Chat Form & Fly ---------- */
  flyToggle.addEventListener('click', () => {
    flyToggle.classList.toggle('on');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !socket) return;
    const fly = flyToggle.classList.contains('on');
    socket.emit('chat', { text, fly });
    chatInput.value = '';
  });

  /* ---------- Movie Sources & Dialog ---------- */
  changeMovie.addEventListener('click', () => {
    sourceDialog.showModal();
  });

  closeDialog.addEventListener('click', () => {
    sourceDialog.close();
  });

  copyLink.addEventListener('click', async () => {
    const url = `${window.location.origin}/r/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied!');
    } catch {
      prompt('Copy invite link:', url);
    }
  });

  controlMode.addEventListener('change', () => {
    if (!isHost || !socket) return;
    socket.emit('control-mode', controlMode.value);
  });

  useUrl.addEventListener('click', () => {
    const u = urlInput.value.trim();
    if (!u || !socket || !isHost) return;
    socket.emit('set-url', { url: u });
    urlInput.value = '';
    sourceDialog.close();
  });

  pickLocal.addEventListener('click', () => {
    localInput.click();
  });

  localInput.addEventListener('change', () => {
    const file = localInput.files[0];
    if (!file) return;
    localFile = file;
    localInput.value = '';

    if (isHost && socket) {
      socket.emit('set-local', { name: file.name, size: file.size });
      sourceDialog.close();
    } else if (currentMovie && currentMovie.kind === 'local') {
      if (file.name === currentMovie.name && file.size === currentMovie.size) {
        setMovie(currentMovie);
      } else {
        showToast(`Selected file doesn't match "${currentMovie.name}" (${formatBytes(currentMovie.size)})`);
      }
    }
  });

  // Chunked Upload from #pickFile
  pickFile.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !isHost) return;
    fileInput.value = '';
    startChunkedUpload(file);
  });

  async function uploadChunk(chunk, offset, total, name, hostToken, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/api/rooms/${roomId}/upload?offset=${offset}&total=${total}&name=${encodeURIComponent(name)}`;
      xhr.open('POST', url);
      xhr.setRequestHeader('x-host-token', hostToken);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded);
        }
      };

      xhr.onload = () => {
        let json = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {}
        resolve({ status: xhr.status, data: json });
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.ontimeout = () => reject(new Error('Upload chunk timed out'));
      xhr.send(chunk);
    });
  }

  async function startChunkedUpload(file) {
    const hostToken = localStorage.getItem(`wt_host_${roomId}`);
    if (!hostToken) {
      showToast('Host token missing');
      return;
    }

    uploadBox.classList.remove('hidden');
    uploadFill.style.width = '0%';
    uploadText.textContent = 'Starting upload…';
    pickFile.disabled = true;

    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
    let offset = 0;
    const total = file.size;
    const name = file.name;
    const startTime = performance.now();
    let retries = 0;
    const MAX_RETRIES = 6;

    while (offset < total) {
      const chunkEnd = Math.min(offset + CHUNK_SIZE, total);
      const chunk = file.slice(offset, chunkEnd);

      const updateProgress = (loadedInChunk) => {
        const currentBytes = Math.min(total, offset + loadedInChunk);
        const elapsed = (performance.now() - startTime) / 1000;
        const mbps = elapsed > 0.1 ? ((currentBytes / (1024 * 1024)) / elapsed).toFixed(1) : '0.0';
        const pct = Math.min(100, Math.round((currentBytes / total) * 100));
        uploadFill.style.width = `${pct}%`;
        uploadText.textContent = `${pct}% · ${mbps} MB/s · ${(currentBytes / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
      };

      try {
        const res = await uploadChunk(chunk, offset, total, name, hostToken, updateProgress);
        if (res.status === 200) {
          retries = 0;
          offset = res.data.received;
          if (res.data.done) break;
        } else if (res.status === 409) {
          // Resume from server's current size
          retries = 0;
          offset = res.data.received;
        } else if (res.status >= 400 && res.status < 500) {
          const err = (res.data && res.data.error) ? res.data.error : `Upload failed (${res.status})`;
          uploadText.textContent = err;
          showToast(err);
          pickFile.disabled = false;
          return;
        } else {
          throw new Error(`Server status ${res.status}`);
        }
      } catch (err) {
        retries++;
        if (retries > MAX_RETRIES) {
          uploadText.textContent = `Upload failed after ${MAX_RETRIES} retries.`;
          showToast('Upload connection lost');
          pickFile.disabled = false;
          return;
        }
        const delay = Math.min(1000 * Math.pow(2, retries), 10000);
        uploadText.textContent = `Retrying in ${(delay / 1000).toFixed(0)}s (attempt ${retries}/${MAX_RETRIES})…`;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    uploadFill.style.width = '100%';
    uploadText.textContent = 'Upload complete!';
    pickFile.disabled = false;
    setTimeout(() => {
      uploadBox.classList.add('hidden');
      sourceDialog.close();
    }, 1000);
  }

  /* ---------- WebRTC Audio Mesh ---------- */
  async function fetchConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.iceServers) iceServers = cfg.iceServers;
      }
    } catch {}
  }

  function removePeer(peerId) {
    const p = peers.get(peerId);
    if (!p) return;
    try {
      p.pc.close();
    } catch {}
    if (p.audioEl) {
      p.audioEl.srcObject = null;
      p.audioEl.remove();
    }
    peers.delete(peerId);
  }

  function createPeerConnection(peerId, isInitiator) {
    if (peers.has(peerId)) {
      removePeer(peerId);
    }

    const pc = new RTCPeerConnection({ iceServers });
    const peerObj = {
      pc,
      audioEl: null,
      analyser: null,
      queuedCandidates: [],
      remoteDescSet: false,
    };
    peers.set(peerId, peerObj);

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('signal', {
          to: peerId,
          data: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      let audioEl = peerObj.audioEl;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioSink.appendChild(audioEl);
        peerObj.audioEl = audioEl;
      }
      audioEl.srcObject = remoteStream;

      if (audioCtx) {
        try {
          const source = audioCtx.createMediaStreamSource(remoteStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          peerObj.analyser = analyser;
        } catch (e) {
          console.warn('Could not attach remote analyser:', e);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeer(peerId);
      }
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (socket) {
            socket.emit('signal', {
              to: peerId,
              data: { type: 'offer', sdp: pc.localDescription },
            });
          }
        } catch (e) {
          console.error('Error creating WebRTC offer:', e);
        }
      };
    }

    return peerObj;
  }

  async function joinVoice() {
    await fetchConfig();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.warn('Microphone permission error:', err);
      showToast('Microphone blocked or not available.');
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(localStream);
      localAnalyser = audioCtx.createAnalyser();
      localAnalyser.fftSize = 256;
      source.connect(localAnalyser);
    } catch (err) {
      console.warn('AudioContext error:', err);
    }

    socket.emit('voice-join', null, (peerIds) => {
      inVoice = true;
      isMuted = false;
      voiceBtn.textContent = '🚪 Leave voice';
      voiceBtn.classList.add('live');
      muteBtn.classList.remove('hidden');
      muteBtn.classList.remove('live');
      muteBtn.textContent = 'Mute mic';

      if (Array.isArray(peerIds)) {
        peerIds.forEach((pid) => {
          createPeerConnection(pid, true);
        });
      }
    });
  }

  function leaveVoice(quiet = false) {
    if (!inVoice && !localStream) return;
    inVoice = false;

    if (!quiet && socket) {
      socket.emit('voice-leave');
    }

    for (const pid of [...peers.keys()]) {
      removePeer(pid);
    }

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }

    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    localAnalyser = null;

    voiceBtn.textContent = '🎙 Join voice';
    voiceBtn.classList.remove('live');
    muteBtn.classList.add('hidden');
    muteBtn.classList.remove('live');
    muteBtn.textContent = 'Mute mic';
    isMuted = false;
  }

  voiceBtn.addEventListener('click', () => {
    if (inVoice) leaveVoice();
    else joinVoice();
  });

  muteBtn.addEventListener('click', () => {
    if (!inVoice || !localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
    muteBtn.textContent = isMuted ? 'Unmute mic' : 'Mute mic';
    muteBtn.classList.toggle('live', isMuted);
    socket.emit('voice-mute', isMuted);
  });

  // Voice Speaking Detector (120ms polling)
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
      if (you) {
        const myLi = document.getElementById(`user-${you.id}`);
        if (myLi) myLi.classList.toggle('speaking', sp);
      }
    } else if (you) {
      const myLi = document.getElementById(`user-${you.id}`);
      if (myLi) myLi.classList.remove('speaking');
    }

    for (const [peerId, pObj] of peers.entries()) {
      const sp = pObj.analyser ? isSpeaking(pObj.analyser) : false;
      const li = document.getElementById(`user-${peerId}`);
      if (li) li.classList.toggle('speaking', sp);
    }
  }, 120);

  /* ---------- Socket.IO Room Wiring ---------- */
  function connectSocket(userName, hostToken) {
    // eslint-disable-next-line no-undef
    socket = io();

    function doJoin() {
      socket.emit('join', { roomId, name: userName, hostToken }, (res) => {
        if (!res || !res.ok) {
          joinError.textContent = (res && res.error) || 'Failed to join room';
          return;
        }

        you = res.you;
        isHost = you.isHost;
        joinedOnce = true;

        landingScreen.classList.add('hidden');
        joinScreen.classList.add('hidden');
        roomScreen.classList.remove('hidden');

        currentControlMode = res.room.controlMode || 'host';
        controlMode.value = currentControlMode;
        updatePermissions();

        renderUserList(res.room.users || []);

        messages.textContent = '';
        if (Array.isArray(res.room.chat)) {
          res.room.chat.forEach(appendChat);
        }

        currentUpload = res.room.upload;
        setMovie(res.room.movie);

        // Snapshot playback state
        if (res.room.state) {
          srv = {
            playing: res.room.state.playing,
            time: res.room.state.time,
            at: performance.now(),
          };
          playBtn.textContent = srv.playing ? '⏸' : '▶';
          stage.classList.toggle('paused', !srv.playing);
          if (video.readyState >= 1) {
            applyHard();
          } else {
            pendingSnapshotState = res.room.state;
          }
        }
      });
    }

    socket.on('connect', () => {
      if (joinedOnce) {
        leaveVoice(true);
        showToast('Reconnected to room');
        doJoin();
      } else {
        doJoin();
      }
    });

    socket.on('users', (users) => {
      renderUserList(users);
      // Drop dead peers
      const voiceIds = new Set(users.filter((u) => u.inVoice).map((u) => u.id));
      for (const [peerId] of peers.entries()) {
        if (!voiceIds.has(peerId)) {
          removePeer(peerId);
        }
      }
    });

    socket.on('movie', (m) => {
      currentUpload = null;
      setMovie(m);
      if (m) showToast(`Movie loaded: ${m.name}`);
    });

    socket.on('upload', (u) => {
      currentUpload = u;
      renderEmptyState();
    });

    socket.on('state', (msg) => {
      srv = {
        playing: msg.playing,
        time: msg.time,
        at: performance.now(),
      };
      playBtn.textContent = srv.playing ? '⏸' : '▶';
      stage.classList.toggle('paused', !srv.playing);

      if (video.readyState >= 1) {
        applyHard();
      }

      if (msg.by && you && msg.by !== you.name) {
        if (msg.action === 'play') showToast(`${msg.by} played`);
        else if (msg.action === 'pause') showToast(`${msg.by} paused`);
        else if (msg.action === 'seek') showToast(`${msg.by} jumped to ${formatTime(msg.time)}`);
      }
    });

    socket.on('sync', (data) => {
      if (video.readyState < 3) return; // skip when not ready
      srv = { playing: data.playing, time: data.time, at: performance.now() };

      if (video.paused && srv.playing) {
        applyHard();
      } else {
        const drift = video.currentTime - target();
        if (Math.abs(drift) > 1.5) {
          video.currentTime = Math.max(0, target());
          video.playbackRate = 1;
        } else if (drift > 0.35) {
          video.playbackRate = 0.95;
        } else if (drift < -0.35) {
          video.playbackRate = 1.05;
        } else {
          video.playbackRate = 1;
        }
      }
    });

    socket.on('countdown', ({ n }) => {
      if (n > 0) {
        countdown.textContent = n;
        countdown.classList.remove('pop');
        void countdown.offsetWidth; // restart animation
        countdown.classList.add('pop');
      } else if (n === 0) {
        countdown.textContent = 'GO!';
        countdown.classList.remove('pop');
        void countdown.offsetWidth;
        countdown.classList.add('pop');
        setTimeout(() => {
          if (countdown.textContent === 'GO!') countdown.textContent = '';
        }, 900);
      } else {
        countdown.textContent = '';
        countdown.classList.remove('pop');
      }
    });

    socket.on('control-mode', (mode) => {
      currentControlMode = mode;
      controlMode.value = mode;
      updatePermissions();
    });

    socket.on('chat', (msg) => {
      appendChat(msg);
    });

    socket.on('reaction', ({ emoji, name }) => {
      showFloater(emoji, name);
    });

    socket.on('nudge', ({ kind, name }) => {
      if (kind === 'pause') showToast(`${name}: ✋ Wait, pause!`);
      else if (kind === 'brb') showToast(`${name}: 🚽 BRB`);
    });

    socket.on('signal', async ({ from, data }) => {
      if (!inVoice || !data) return;

      if (data.type === 'offer') {
        let peerObj = peers.get(from);
        if (!peerObj) {
          peerObj = createPeerConnection(from, false);
        }
        try {
          await peerObj.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          peerObj.remoteDescSet = true;
          while (peerObj.queuedCandidates.length > 0) {
            const cand = peerObj.queuedCandidates.shift();
            await peerObj.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.warn);
          }
          const answer = await peerObj.pc.createAnswer();
          await peerObj.pc.setLocalDescription(answer);
          socket.emit('signal', {
            to: from,
            data: { type: 'answer', sdp: peerObj.pc.localDescription },
          });
        } catch (e) {
          console.error('Error handling WebRTC offer:', e);
        }
      } else if (data.type === 'answer') {
        const peerObj = peers.get(from);
        if (peerObj) {
          try {
            await peerObj.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            peerObj.remoteDescSet = true;
            while (peerObj.queuedCandidates.length > 0) {
              const cand = peerObj.queuedCandidates.shift();
              await peerObj.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.warn);
            }
          } catch (e) {
            console.error('Error handling WebRTC answer:', e);
          }
        }
      } else if (data.type === 'candidate') {
        const peerObj = peers.get(from);
        if (peerObj) {
          if (peerObj.remoteDescSet && peerObj.pc.remoteDescription) {
            peerObj.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.warn);
          } else {
            peerObj.queuedCandidates.push(data.candidate);
          }
        }
      }
    });
  }

  /* ---------- App Routing & Initialization ---------- */
  async function init() {
    const path = window.location.pathname;
    const match = path.match(/^\/r\/([a-zA-Z0-9_-]+)/);

    if (match) {
      roomId = match[1].toLowerCase();
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
      } catch (err) {
        joinScreen.classList.remove('hidden');
        joinError.textContent = 'Could not check room status.';
        return;
      }

      joinCode.textContent = roomId;
      const savedName = localStorage.getItem('wt_name') || '';
      joinName.value = savedName;
      joinScreen.classList.remove('hidden');

      const enterRoom = () => {
        const name = (joinName.value || '').trim() || 'Guest';
        localStorage.setItem('wt_name', name);
        const hostToken = localStorage.getItem(`wt_host_${roomId}`) || undefined;
        connectSocket(name, hostToken);
      };

      enterBtn.addEventListener('click', enterRoom);
      joinName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          enterRoom();
        }
      });
    } else {
      // Landing page: create a room
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
      landingName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCreate();
        }
      });
    }
  }

  init();
})();
