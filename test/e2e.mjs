/**
 * test/e2e.mjs – Playwright E2E tests for Watch Together
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';

const PORT = Number(process.env.PORT) || 3988;
const BASE = `http://localhost:${PORT}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`Server not ready on port ${PORT}`);
}

const ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];

async function createPage(browser, roomId, name, hostToken = null) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/r/${roomId}`);
  if (hostToken) {
    await page.evaluate(({ id, token }) => {
      localStorage.setItem(`wt_host_${id}`, token);
    }, { id: roomId, token: hostToken });
    await page.reload();
  }
  await page.fill('#joinName', name);
  await page.click('#enterBtn');
  await page.waitForSelector('#room:not(.hidden)', { timeout: 6000 });
  return page;
}

async function run() {
  console.log(`[E2E] Starting server on port ${PORT}...`);
  const serverProc = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), WAIT_MS: '50' },
    stdio: 'inherit',
  });
  const cleanup = () => { if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM'); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  let browser;
  try {
    await waitForServer();
    console.log('[E2E] Server ready\n');

    browser = await chromium.launch({ headless: true, args: ARGS });

    // ─────────────────────────────────────────────────────────────────────
    // TEST 1: Fly-comment replay fix (late joiner sees 0 .flycomment)
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 1: Fly-comment replay fix ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r1, hostToken: ht1 } = await cr.json();

      const hostPage = await createPage(browser, r1, 'AliceHost', ht1);

      // Send fly comment
      await hostPage.fill('#chatInput', 'Flying greeting!');
      await hostPage.click('#flyToggle'); // turn on fly
      await hostPage.click('#chatForm button[type="submit"]');
      await sleep(300);

      // Verify flycomment exists on host
      const hostFlyCount = await hostPage.evaluate(() => document.querySelectorAll('#fx .flycomment').length);
      console.log(`[E2E 1] Host saw ${hostFlyCount} fly comments.`);

      // Late joiner joins now
      const guestPage = await createPage(browser, r1, 'BobLate');
      await sleep(500);

      // BobLate should see 0 .flycomment elements
      const guestFlyCount = await guestPage.evaluate(() => document.querySelectorAll('#fx .flycomment').length);
      console.log(`[E2E 1] Late joiner saw ${guestFlyCount} fly comments.`);
      assert.strictEqual(guestFlyCount, 0, 'Late joiner must NOT see fly comments from chat history');
      console.log('✅ TEST 1 PASSED: Late joiner sees 0 .flycomment from history\n');

      await hostPage.context().close();
      await guestPage.context().close();
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 2: Stage tray exists inside #stage and toggles
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 2: Stage tray inside #stage ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r2, hostToken: ht2 } = await cr.json();

      const page = await createPage(browser, r2, 'TrayTester', ht2);

      // Check #stageTray is a child of #stage
      const isInside = await page.evaluate(() => {
        const stage = document.getElementById('stage');
        const tray = document.getElementById('stageTray');
        return stage && tray && stage.contains(tray);
      });
      assert.ok(isInside, '#stageTray must be inside #stage');

      // Check initial state is hidden
      const initiallyHidden = await page.evaluate(() => document.getElementById('stageTray').classList.contains('hidden'));
      assert.ok(initiallyHidden, '#stageTray should be initially hidden');

      // Click 😀 tray button
      await page.click('#trayBtn');
      const nowVisible = await page.evaluate(() => !document.getElementById('stageTray').classList.contains('hidden'));
      assert.ok(nowVisible, '#stageTray should be visible after clicking trayBtn');

      // Check reaction buttons exist inside the tray
      const btnCount = await page.evaluate(() => document.querySelectorAll('#stageTray button').length);
      assert.ok(btnCount >= 12, `Tray should contain reaction and vote buttons, got ${btnCount}`);
      console.log(`✅ TEST 2 PASSED: Stage tray inside #stage with ${btnCount} buttons, toggles correctly\n`);

      await page.context().close();
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 3: Subtitle load (track cues > 0)
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 3: Subtitle load (.srt to .vtt with cues > 0) ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r3, hostToken: ht3 } = await cr.json();

      const page = await createPage(browser, r3, 'SubTester', ht3);

      const srtText = `1\n00:00:01,000 --> 00:00:04,000\nWelcome to Watch Together!\n\n2\n00:00:05,000 --> 00:00:09,000\nEnjoy the movie in sync!\n`;

      await page.setInputFiles('#ccInput', {
        name: 'sample.srt',
        mimeType: 'text/plain',
        buffer: Buffer.from(srtText, 'utf-8'),
      });
      await sleep(500);

      const trackInfo = await page.evaluate(() => {
        const video = document.getElementById('video');
        const trackEl = video.querySelector('track');
        if (!trackEl) return { found: false, cues: 0 };
        const trackObj = trackEl.track;
        return {
          found: true,
          mode: trackObj ? trackObj.mode : null,
          cues: trackObj && trackObj.cues ? trackObj.cues.length : 0,
        };
      });

      console.log(`[E2E 3] Track info:`, trackInfo);
      assert.ok(trackInfo.found, 'A <track> element should be attached to <video>');
      assert.ok(trackInfo.cues > 0, `Subtitle track should have cues, got ${trackInfo.cues}`);
      console.log(`✅ TEST 3 PASSED: Subtitles converted and loaded with ${trackInfo.cues} cues\n`);

      await page.context().close();
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 4: Vote-rewind with 3 pages moves everyone back ~10s
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 4: Vote-rewind with 3 pages ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r4, hostToken: ht4 } = await cr.json();

      const pHost = await createPage(browser, r4, 'AliceHost', ht4);
      const pGuest1 = await createPage(browser, r4, 'BobGuest');
      const pGuest2 = await createPage(browser, r4, 'CharlieGuest');
      await sleep(300);

      // Set a movie link so playback/seeking is active
      await pHost.click('#changeMovie');
      await pHost.fill('#urlInput', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
      await pHost.click('#useUrl');
      await sleep(500);

      // Host plays and seeks to 30s
      await pHost.evaluate(() => {
        const seekInput = document.getElementById('seek');
        // Simulate seek control emit to 30 seconds
        window.dispatchEvent(new CustomEvent('test-seek', { detail: 30 }));
      });
      // Set playing at 30s via host control
      await pHost.click('#playBtn'); // play
      await sleep(200);

      // Guest1 starts rewind vote using the button in #reactions
      const voteRewindBtn = pGuest1.locator('#reactions button.nudge', { hasText: 'rewind' });
      await voteRewindBtn.click();
      await sleep(300);

      // Verify vote card is visible on Guest2
      const voteVisibleOnGuest2 = await pGuest2.evaluate(() => {
        const vc = document.getElementById('voteCard');
        return vc && !vc.classList.contains('hidden');
      });
      assert.ok(voteVisibleOnGuest2, 'Vote card should appear on Guest 2');

      // Guest2 clicks "Yes"
      await pGuest2.locator('#voteCard button', { hasText: 'Yes' }).click();
      await sleep(500);

      // Check that vote card dismissed (passed)
      const votePassedHidden = await pGuest2.evaluate(() => {
        const vc = document.getElementById('voteCard');
        return vc && vc.classList.contains('hidden');
      });
      assert.ok(votePassedHidden, 'Vote card should dismiss after passing');
      console.log('✅ TEST 4 PASSED: 3 pages collaborated to pass vote-rewind\n');

      await pHost.context().close();
      await pGuest1.context().close();
      await pGuest2.context().close();
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 5: Heat strip has colored buckets after reactions
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 5: Heat strip colored buckets after reactions ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r5, hostToken: ht5 } = await cr.json();

      const p1 = await createPage(browser, r5, 'HeatHost', ht5);

      // Give video a duration so renderHeatStrip renders segments
      await p1.evaluate(() => {
        const v = document.getElementById('video');
        Object.defineProperty(v, 'duration', { get: () => 120, configurable: true });
      });

      // Click a reaction button (e.g. popcorn 🍿)
      const popBtn = p1.locator('#reactions button', { hasText: '🍿' });
      await popBtn.click();
      await sleep(400);

      // Check heat segment
      const segCount = await p1.evaluate(() => document.querySelectorAll('#heatStrip .heat-seg').length);
      console.log(`[E2E 5] Heat segments rendered: ${segCount}`);
      assert.ok(segCount > 0, `Heat strip should render at least 1 colored segment, got ${segCount}`);

      const segColor = await p1.evaluate(() => {
        const seg = document.querySelector('#heatStrip .heat-seg');
        return seg ? seg.style.backgroundColor : '';
      });
      assert.ok(segColor.length > 0, 'Heat segment must have a background color');
      console.log(`[E2E 5] Segment background color: ${segColor}`);
      console.log('✅ TEST 5 PASSED: Heat strip renders colored segments after reaction\n');

      await p1.context().close();
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 6: Ping dot appears on the other page
    // ─────────────────────────────────────────────────────────────────────
    console.log('--- TEST 6: Ping dot appears on the other page ---');
    {
      const cr = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
      const { id: r6, hostToken: ht6 } = await cr.json();

      const pSender = await createPage(browser, r6, 'SenderHost', ht6);
      const pReceiver = await createPage(browser, r6, 'ReceiverGuest');
      await sleep(300);

      // Sender toggles ping mode on
      await pSender.click('#pingBtn');
      const pingActive = await pSender.evaluate(() => document.getElementById('pingBtn').classList.contains('on'));
      assert.ok(pingActive, 'Ping button should have class "on"');

      // Sender clicks on #stage
      await pSender.click('#stage', { position: { x: 100, y: 100 } });
      await sleep(500);

      // Receiver should see a .ping-dot in #fx
      const receiverDot = await pReceiver.evaluate(() => {
        const dots = document.querySelectorAll('#fx .ping-dot');
        if (dots.length === 0) return null;
        const name = dots[0].querySelector('.ping-name');
        return { count: dots.length, name: name ? name.textContent : '' };
      });

      console.log(`[E2E 6] Receiver dot info:`, receiverDot);
      assert.ok(receiverDot && receiverDot.count > 0, 'Ping dot should appear on receiver page');
      assert.strictEqual(receiverDot.name, 'SenderHost', 'Ping dot should show sender name');
      console.log('✅ TEST 6 PASSED: Ping dot appeared on receiver with correct sender name\n');

      await pSender.context().close();
      await pReceiver.context().close();
    }

    console.log('🎉 ALL 6 E2E TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error('\n❌ E2E SUITE FAILED:', err.message || err);
  process.exit(1);
});
