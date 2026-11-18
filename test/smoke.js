'use strict';

const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const { io: ioClient } = require('socket.io-client');

const PORT = Number(process.env.PORT) || 3987;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.ok) return;
    } catch (e) {
      // wait and retry
    }
    await sleep(200);
  }
  throw new Error(`Server failed to start on port ${PORT}`);
}

async function run() {
  console.log(`[TEST] Starting server on port ${PORT}...`);
  const serverProcess = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  const cleanup = () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  try {
    await waitForServer();
    console.log('[TEST] Server is ready at', BASE_URL);

    // 1. Create room via POST /api/rooms
    console.log('\n--- STEP 1.1: Create room ---');
    const createRes = await fetch(`${BASE_URL}/api/rooms`, { method: 'POST' });
    assert.strictEqual(createRes.status, 200, 'POST /api/rooms should return 200');
    const roomData = await createRes.json();
    console.log('[TEST] Created room:', roomData);
    assert.ok(roomData.id, 'Room ID should be present');
    assert.ok(roomData.hostToken, 'hostToken should be present');
    const roomId = roomData.id;
    const hostToken = roomData.hostToken;

    // Check GET /api/rooms/:id
    const checkRes = await fetch(`${BASE_URL}/api/rooms/${roomId}`);
    assert.strictEqual(checkRes.status, 200);
    const checkJson = await checkRes.json();
    assert.strictEqual(checkJson.exists, true, 'Room should exist');

    // 2. Join 2 sockets
    console.log('\n--- STEP 1.2: Join 2 sockets ---');
    const socketHost = ioClient(BASE_URL, { reconnection: false });
    const socketGuest = ioClient(BASE_URL, { reconnection: false });

    await new Promise((resolve) => socketHost.on('connect', resolve));
    await new Promise((resolve) => socketGuest.on('connect', resolve));
    console.log('[TEST] Both sockets connected');

    // Host joins
    const hostJoinAck = await new Promise((resolve) => {
      socketHost.emit('join', { roomId, name: 'Alice (Host)', hostToken }, resolve);
    });
    console.log('[TEST] Host joined ack:', hostJoinAck.ok, 'isHost:', hostJoinAck.you.isHost);
    assert.strictEqual(hostJoinAck.ok, true);
    assert.strictEqual(hostJoinAck.you.isHost, true);

    // Guest joins
    const guestJoinAck = await new Promise((resolve) => {
      socketGuest.emit('join', { roomId, name: 'Bob (Guest)' }, resolve);
    });
    console.log('[TEST] Guest joined ack:', guestJoinAck.ok, 'isHost:', guestJoinAck.you.isHost);
    assert.strictEqual(guestJoinAck.ok, true);
    assert.strictEqual(guestJoinAck.you.isHost, false);

    // 3. Upload 10MB dummy .mp4 in 4MB chunks to POST /api/rooms/:id/upload
    console.log('\n--- STEP 1.3: Upload 10MB dummy .mp4 in 4MB chunks ---');
    const TOTAL_SIZE = 10 * 1024 * 1024; // 10MB
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
    const dummyBuffer = Buffer.alloc(TOTAL_SIZE, 0x42);
    const fileName = 'test_movie.mp4';

    // Set up listeners for 'movie' event on both sockets
    const hostMoviePromise = new Promise((resolve) => socketHost.once('movie', resolve));
    const guestMoviePromise = new Promise((resolve) => socketGuest.once('movie', resolve));

    let offset = 0;
    while (offset < TOTAL_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, TOTAL_SIZE);
      const chunk = dummyBuffer.subarray(offset, end);
      console.log(`[TEST] Uploading chunk offset=${offset}, length=${chunk.length}, total=${TOTAL_SIZE}...`);

      const uploadRes = await fetch(
        `${BASE_URL}/api/rooms/${roomId}/upload?offset=${offset}&total=${TOTAL_SIZE}&name=${encodeURIComponent(fileName)}`,
        {
          method: 'POST',
          headers: {
            'x-host-token': hostToken,
            'Content-Type': 'application/octet-stream',
          },
          body: chunk,
        }
      );
      assert.strictEqual(uploadRes.status, 200, `Upload chunk at ${offset} should return 200`);
      const uploadJson = await uploadRes.json();
      console.log(`[TEST] Chunk response:`, uploadJson);
      offset = uploadJson.received;
    }

    // 4. Checks both sockets get 'movie'
    console.log('\n--- STEP 1.4: Verify both sockets received "movie" event ---');
    const [hostMovie, guestMovie] = await Promise.all([hostMoviePromise, guestMoviePromise]);
    console.log('[TEST] Host received movie event:', hostMovie);
    console.log('[TEST] Guest received movie event:', guestMovie);
    assert.ok(hostMovie && hostMovie.url, 'Host movie event should have url');
    assert.ok(guestMovie && guestMovie.url, 'Guest movie event should have url');
    assert.strictEqual(hostMovie.url, guestMovie.url, 'Movie URLs should match');
    assert.strictEqual(hostMovie.name, fileName);
    assert.strictEqual(hostMovie.size, TOTAL_SIZE);

    // 5. Does a Range request on the movie url and shows a 206
    console.log('\n--- STEP 1.5: Range request on movie URL ---');
    const rangeRes = await fetch(`${BASE_URL}${hostMovie.url}`, {
      headers: {
        Range: 'bytes=0-1023',
      },
    });
    console.log('[TEST] Range request HTTP status:', rangeRes.status);
    assert.strictEqual(rangeRes.status, 206, 'Range request should return 206 Partial Content');
    const contentRange = rangeRes.headers.get('content-range');
    const contentLength = rangeRes.headers.get('content-length');
    console.log('[TEST] Content-Range header:', contentRange);
    console.log('[TEST] Content-Length header:', contentLength);
    assert.ok(contentRange && contentRange.startsWith('bytes 0-1023/10485760'), 'Content-Range should indicate 0-1023/10485760');
    assert.strictEqual(contentLength, '1024', 'Content-Length should be 1024');
    const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
    assert.strictEqual(rangeBuf.length, 1024);

    // 6. Sends 'control' play then seek and checks both get 'state'
    console.log('\n--- STEP 1.6: Control play and seek ---');
    // Test play
    let hostStatePromise = new Promise((resolve) => socketHost.once('state', resolve));
    let guestStatePromise = new Promise((resolve) => socketGuest.once('state', resolve));

    console.log('[TEST] Host emits control play...');
    socketHost.emit('control', { action: 'play', time: 5 });
    let [hostState, guestState] = await Promise.all([hostStatePromise, guestStatePromise]);
    console.log('[TEST] Host got state:', hostState);
    console.log('[TEST] Guest got state:', guestState);
    assert.strictEqual(hostState.playing, true);
    assert.strictEqual(hostState.action, 'play');
    assert.strictEqual(guestState.playing, true);
    assert.strictEqual(guestState.action, 'play');

    // Test seek
    hostStatePromise = new Promise((resolve) => socketHost.once('state', resolve));
    guestStatePromise = new Promise((resolve) => socketGuest.once('state', resolve));

    console.log('[TEST] Host emits control seek to time 120...');
    socketHost.emit('control', { action: 'seek', time: 120 });
    [hostState, guestState] = await Promise.all([hostStatePromise, guestStatePromise]);
    console.log('[TEST] Host got state after seek:', hostState);
    console.log('[TEST] Guest got state after seek:', guestState);
    assert.strictEqual(hostState.action, 'seek');
    assert.strictEqual(hostState.time, 120);
    assert.strictEqual(guestState.action, 'seek');
    assert.strictEqual(guestState.time, 120);

    // 7. Sends chat + reaction
    console.log('\n--- STEP 1.7: Chat and reaction ---');
    const hostChatPromise = new Promise((resolve) => socketHost.once('chat', resolve));
    const guestChatPromise = new Promise((resolve) => socketGuest.once('chat', resolve));

    console.log('[TEST] Guest emits chat...');
    socketGuest.emit('chat', { text: 'Hello everyone!', fly: true });
    const [hostChat, guestChat] = await Promise.all([hostChatPromise, guestChatPromise]);
    console.log('[TEST] Host got chat:', hostChat);
    console.log('[TEST] Guest got chat:', guestChat);
    assert.strictEqual(hostChat.text, 'Hello everyone!');
    assert.strictEqual(hostChat.fly, true);
    assert.strictEqual(guestChat.text, 'Hello everyone!');

    const hostReactPromise = new Promise((resolve) => socketHost.once('reaction', resolve));
    const guestReactPromise = new Promise((resolve) => socketGuest.once('reaction', resolve));

    console.log('[TEST] Guest emits reaction 🍿...');
    socketGuest.emit('reaction', '🍿');
    const [hostReact, guestReact] = await Promise.all([hostReactPromise, guestReactPromise]);
    console.log('[TEST] Host got reaction:', hostReact);
    console.log('[TEST] Guest got reaction:', guestReact);
    assert.strictEqual(hostReact.emoji, '🍿');
    assert.strictEqual(guestReact.emoji, '🍿');

    // 8. Relays a 'signal'
    console.log('\n--- STEP 1.8: Relay WebRTC signal ---');
    const guestSignalPromise = new Promise((resolve) => socketGuest.once('signal', resolve));
    const hostSocketId = socketHost.id;
    const guestSocketId = socketGuest.id;

    console.log(`[TEST] Host sending signal to guest (${guestSocketId})...`);
    socketHost.emit('signal', {
      to: guestSocketId,
      data: { type: 'offer', sdp: 'fake-sdp-data' },
    });
    const guestSignal = await guestSignalPromise;
    console.log('[TEST] Guest received signal:', guestSignal);
    assert.strictEqual(guestSignal.from, hostSocketId);
    assert.strictEqual(guestSignal.data.type, 'offer');
    assert.strictEqual(guestSignal.data.sdp, 'fake-sdp-data');

    // 9. Checks a non-host 'control' is ignored
    console.log('\n--- STEP 1.9: Non-host control ignored in "host" mode ---');
    let nonHostStateReceived = false;
    const stateChecker = () => { nonHostStateReceived = true; };
    socketHost.on('state', stateChecker);
    socketGuest.on('state', stateChecker);

    console.log('[TEST] Guest emits control pause (should be ignored)...');
    socketGuest.emit('control', { action: 'pause', time: 50 });
    await sleep(600);
    socketHost.off('state', stateChecker);
    socketGuest.off('state', stateChecker);

    assert.strictEqual(nonHostStateReceived, false, 'Non-host control should be ignored by server');
    console.log('[TEST] Confirmed: non-host control was ignored!');

    // 10. Checks a wrong x-host-token upload returns 403
    console.log('\n--- STEP 1.10: Wrong x-host-token upload returns 403 ---');
    const badUploadRes = await fetch(
      `${BASE_URL}/api/rooms/${roomId}/upload?offset=0&total=1024&name=dummy.mp4`,
      {
        method: 'POST',
        headers: {
          'x-host-token': 'wrong-host-token-12345',
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.alloc(1024, 0),
      }
    );
    console.log('[TEST] Bad token response status:', badUploadRes.status);
    assert.strictEqual(badUploadRes.status, 403, 'Bad host token should return 403');
    const badUploadJson = await badUploadRes.json();
    console.log('[TEST] Bad token response body:', badUploadJson);
    assert.strictEqual(badUploadJson.error, 'Only the host can upload');

    // Disconnect sockets
    socketHost.disconnect();
    socketGuest.disconnect();

    console.log('\n✅ ALL SMOKE TESTS PASSED SUCCESSFULLY!');
  } finally {
    cleanup();
  }
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ SMOKE TEST FAILED:', err);
  process.exit(1);
});
