'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_GB) || 8) * 1024 ** 3;
const ALLOWED_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.mkv']);
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // delete empty rooms (and their movie) after 2h
const REACTIONS = new Set(['❤️', '😂', '😮', '😢', '👏', '🔥', '💀', '🍿', '👀', '🥶']);

// Rooms live in memory, so any leftover files from a previous run are orphans.
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const rooms = new Map();

/* ---------- helpers ---------- */

function makeId() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += A[b % A.length];
  return s;
}

function newRoom() {
  let id;
  do { id = makeId(); } while (rooms.has(id));
  const room = {
    id,
    hostToken: crypto.randomBytes(24).toString('hex'),
    lastActive: Date.now(),
    users: new Map(),
    movie: null,
    state: { playing: false, time: 0, updatedAt: Date.now() },
    controlMode: 'host', // 'host' = only host controls playback, 'all' = everyone
    chat: [],
    upload: null,
    countdown: null,
  };
  rooms.set(id, room);
  return room;
}

const position = (r) => (r.state.playing ? r.state.time + (Date.now() - r.state.updatedAt) / 1000 : r.state.time);
const setState = (r, playing, time) => { r.state = { playing, time, updatedAt: Date.now() }; };
const publicUsers = (r) => [...r.users.entries()].map(([id, u]) => ({
  id, name: u.name, isHost: u.isHost, inVoice: u.inVoice, muted: u.muted,
}));
const publicMovie = (r) => (r.movie ? { kind: r.movie.kind, name: r.movie.name, size: r.movie.size, url: r.movie.url } : null);
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Guest';

function sys(r, text) {
  const msg = { id: crypto.randomBytes(4).toString('hex'), system: true, text, t: Date.now() };
  r.chat.push(msg);
  if (r.chat.length > 100) r.chat.shift();
  io.to(r.id).emit('chat', msg);
}

function cancelCountdown(r) {
  if (!r.countdown) return;
  clearInterval(r.countdown);
  r.countdown = null;
  io.to(r.id).emit('countdown', { n: -1 });
}

function removeMovieFile(r) {
  if (r.movie && r.movie.file) fs.rm(path.join(UPLOAD_DIR, r.movie.file), { force: true }, () => {});
}

function resetPlayback(r) {
  cancelCountdown(r);
  setState(r, false, 0);
  io.to(r.id).emit('state', { playing: false, time: 0, action: 'reset' });
}

function destroyRoom(r) {
  cancelCountdown(r);
  removeMovieFile(r);
  fs.rm(path.join(UPLOAD_DIR, `${r.id}.part`), { force: true }, () => {});
  rooms.delete(r.id);
}

/* ---------- HTTP ---------- */

app.use(express.json({ limit: '10kb' }));

app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/api/config', (_req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  }
  res.json({ iceServers, maxUploadBytes: MAX_BYTES });
});

app.post('/api/rooms', (_req, res) => {
  const r = newRoom();
  res.json({ id: r.id, hostToken: r.hostToken });
});

app.get('/api/rooms/:id', (req, res) => {
  res.json({ exists: rooms.has(String(req.params.id).toLowerCase()) });
});

// Chunked upload: the client sends the file in small pieces (works behind tunnels with request-size limits
// and can resume after a network hiccup).
app.post('/api/rooms/:id/upload', express.raw({ type: '*/*', limit: '16mb' }), (req, res) => {
  const room = rooms.get(String(req.params.id).toLowerCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (req.get('x-host-token') !== room.hostToken) return res.status(403).json({ error: 'Only the host can upload' });

  const offset = Number(req.query.offset);
  const total = Number(req.query.total);
  const name = String(req.query.name || 'movie').slice(0, 200);
  const ext = path.extname(name).toLowerCase();
  const buf = req.body;

  if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'Unsupported file type. Use MP4 (H.264/AAC) or WebM.' });
  if (!Number.isFinite(offset) || !Number.isFinite(total) || offset < 0 || total <= 0) return res.status(400).json({ error: 'Bad range' });
  if (total > MAX_BYTES) return res.status(413).json({ error: `File too large (limit ${Math.round(MAX_BYTES / 1024 ** 3)} GB)` });
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Empty chunk' });
  if (offset + buf.length > total) return res.status(400).json({ error: 'Chunk exceeds declared size' });

  const part = path.join(UPLOAD_DIR, `${room.id}.part`);
  try {
    if (offset === 0) {
      fs.writeFileSync(part, buf);
    } else {
      const size = fs.existsSync(part) ? fs.statSync(part).size : 0;
      if (size !== offset) return res.status(409).json({ received: size }); // client resumes from here
      fs.appendFileSync(part, buf);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Could not write file on the server' });
  }

  const received = offset + buf.length;
  room.lastActive = Date.now();

  if (received < total) {
    room.upload = { name, received, total };
    io.to(room.id).emit('upload', room.upload);
    return res.json({ received, done: false });
  }

  const file = `${room.id}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.renameSync(part, path.join(UPLOAD_DIR, file));
  removeMovieFile(room);
  room.movie = { kind: 'upload', name, size: total, url: `/media/${file}`, file };
  room.upload = null;
  resetPlayback(room);
  io.to(room.id).emit('upload', null);
  io.to(room.id).emit('movie', publicMovie(room));
  sys(room, `🎬 "${name}" is ready`);
  res.json({ received, done: true });
});

// Range requests (seeking) are handled by sendFile.
app.get('/media/:file', (req, res) => {
  const f = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, f);
  if (f.endsWith('.part') || !fs.existsSync(full)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(full, { acceptRanges: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/r/:id', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------- realtime ---------- */

io.on('connection', (socket) => {
  let room = null;
  let lastReact = 0;
  let lastChat = 0;
  const me = () => (room ? room.users.get(socket.id) : null);
  const canControl = () => { const u = me(); return !!u && (u.isHost || room.controlMode === 'all'); };
  const isHost = () => { const u = me(); return !!u && u.isHost; };
  const reply = (cb, v) => { if (typeof cb === 'function') cb(v); };

  socket.on('join', (p, cb) => {
    if (room) return;
    const r = rooms.get(String((p && p.roomId) || '').toLowerCase());
    if (!r) return reply(cb, { error: 'Room not found or expired' });
    room = r;
    const host = !!(p.hostToken && p.hostToken === r.hostToken);
    const name = cleanName(p.name);
    r.users.set(socket.id, { name, isHost: host, inVoice: false, muted: false });
    r.lastActive = Date.now();
    socket.join(r.id);
    sys(r, `${name} joined`);
    io.to(r.id).emit('users', publicUsers(r));
    reply(cb, {
      ok: true,
      you: { id: socket.id, name, isHost: host },
      room: {
        users: publicUsers(r),
        movie: publicMovie(r),
        state: { playing: r.state.playing, time: position(r) },
        controlMode: r.controlMode,
        chat: r.chat,
        upload: r.upload,
      },
    });
  });

  /* playback */
  socket.on('control', (p) => {
    if (!room || !room.movie || !canControl() || !p) return;
    cancelCountdown(room);
    const t = Number.isFinite(p.time) ? Math.max(0, p.time) : position(room);
    if (p.action === 'play') setState(room, true, t);
    else if (p.action === 'pause') setState(room, false, t);
    else if (p.action === 'seek') setState(room, room.state.playing, t);
    else return;
    room.lastActive = Date.now();
    io.to(room.id).emit('state', { playing: room.state.playing, time: t, by: me().name, action: p.action });
  });

  socket.on('countdown', () => {
    if (!room || !room.movie || !canControl() || room.countdown) return;
    const t = position(room);
    setState(room, false, t);
    io.to(room.id).emit('state', { playing: false, time: t, action: 'pause' });
    let n = 3;
    io.to(room.id).emit('countdown', { n });
    room.countdown = setInterval(() => {
      n -= 1;
      if (n > 0) return io.to(room.id).emit('countdown', { n });
      clearInterval(room.countdown);
      room.countdown = null;
      setState(room, true, t);
      io.to(room.id).emit('countdown', { n: 0 });
      io.to(room.id).emit('state', { playing: true, time: t, action: 'play' });
    }, 1000);
  });

  /* host-only: movie source + permissions */
  socket.on('set-url', (p) => {
    if (!room || !isHost() || !p) return;
    let u;
    try { u = new URL(String(p.url)); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    removeMovieFile(room);
    room.movie = { kind: 'url', name: decodeURIComponent(u.pathname.split('/').pop() || u.hostname).slice(0, 120), size: 0, url: u.href, file: null };
    resetPlayback(room);
    io.to(room.id).emit('movie', publicMovie(room));
    sys(room, `🎬 Movie set from a link`);
  });

  socket.on('set-local', (p) => {
    if (!room || !isHost() || !p) return;
    removeMovieFile(room);
    room.movie = { kind: 'local', name: String(p.name || 'movie').slice(0, 200), size: Number(p.size) || 0, url: null, file: null };
    resetPlayback(room);
    io.to(room.id).emit('movie', publicMovie(room));
    sys(room, `🎬 Everyone: pick "${room.movie.name}" from your own device`);
  });

  socket.on('control-mode', (mode) => {
    if (!room || !isHost() || (mode !== 'host' && mode !== 'all')) return;
    room.controlMode = mode;
    io.to(room.id).emit('control-mode', mode);
    sys(room, mode === 'all' ? 'Everyone can now control playback' : 'Only the host controls playback');
  });

  /* fun stuff */
  socket.on('chat', (p) => {
    if (!room || !p) return;
    const now = Date.now();
    if (now - lastChat < 250) return;
    lastChat = now;
    const text = String(p.text || '').trim().slice(0, 500);
    if (!text) return;
    const msg = { id: crypto.randomBytes(4).toString('hex'), name: me().name, from: socket.id, text, fly: !!p.fly, t: now };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    io.to(room.id).emit('chat', msg);
  });

  socket.on('reaction', (emoji) => {
    if (!room || !REACTIONS.has(emoji)) return;
    const now = Date.now();
    if (now - lastReact < 80) return;
    lastReact = now;
    io.to(room.id).emit('reaction', { emoji, name: me().name });
  });

  socket.on('nudge', (kind) => {
    if (!room || !['pause', 'brb'].includes(kind)) return;
    io.to(room.id).emit('nudge', { kind, name: me().name });
  });

  /* voice (WebRTC mesh; the server only relays signalling) */
  socket.on('voice-join', (_p, cb) => {
    if (!room) return;
    const others = [...room.users.entries()].filter(([id, u]) => id !== socket.id && u.inVoice).map(([id]) => id);
    me().inVoice = true;
    me().muted = false;
    io.to(room.id).emit('users', publicUsers(room));
    reply(cb, others);
  });

  socket.on('voice-leave', () => {
    if (!room || !me()) return;
    me().inVoice = false;
    me().muted = false;
    io.to(room.id).emit('users', publicUsers(room));
  });

  socket.on('voice-mute', (muted) => {
    if (!room || !me()) return;
    me().muted = !!muted;
    io.to(room.id).emit('users', publicUsers(room));
  });

  socket.on('signal', (p) => {
    if (!room || !p || !room.users.has(p.to)) return;
    io.to(p.to).emit('signal', { from: socket.id, data: p.data });
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const u = me();
    room.users.delete(socket.id);
    room.lastActive = Date.now();
    if (u) sys(room, `${u.name} left`);
    if (u && u.isHost && room.upload) {
      room.upload = null;
      io.to(room.id).emit('upload', null);
    }
    if (!room.users.size && room.state.playing) {
      setState(room, false, position(room));
      cancelCountdown(room);
    }
    io.to(room.id).emit('users', publicUsers(room));
  });
});

// Keep everyone's playback tight: broadcast the authoritative position while playing.
setInterval(() => {
  for (const r of rooms.values()) {
    if (r.state.playing && r.users.size) io.to(r.id).emit('sync', { time: position(r), playing: true });
  }
}, 4000);

// Clean up abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.users.size && now - r.lastActive > IDLE_TTL_MS) destroyRoom(r);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Watch Together running on http://localhost:${PORT}`));
