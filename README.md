# Watch Together 🍿🎬

Watch Together is a lightweight watch-party web application where a host uploads or links a video, and everyone watches together in real-time sync with WebRTC voice chat, live text chat, floating emojis, flying comments, interactive votes, subtitle support, and point-at-screen laser pings.

Built with **Node 18+**, **Express 4**, **Socket.IO 4**, and **vanilla JavaScript** with zero build steps or frontend frameworks.

---

## Features

### Playback & Video Modes
- **Authoritative Real-Time Sync**: Server-authoritative playback engine with adaptive drift correction (playbackRate micro-adjustments and seeking).
- **Chunked Resumable Uploads**: 4MB chunked upload pipeline with live progress, MB/s tracking, and automatic retry with exponential backoff.
- **Three Movie Modes**:
  1. **Upload**: Stream an MP4/WebM video file directly from the host's machine.
  2. **Local File**: Zero-bandwidth mode where each participant selects their local copy of the same video file while the room synchronizes playback.
  3. **Direct Link**: Stream video directly from any public URL.

### Viewer Quality & Buffering (Phase B)
- **Buffering Indicators**: Visual `⏳` badge in the participant list when a viewer's video is buffering for >1 second.
- **Host-Only "Wait for Everyone" Mode**: When enabled, the room auto-pauses (`by: Auto`) if any participant buffers continuously for >1.5 seconds. Once all participants have buffered, playback automatically resumes with a 3-2-1 countdown.
- **Local Subtitles (`CC`)**: Load `.srt` or `.vtt` subtitle files entirely in-browser (converted to WebVTT with BOM stripping, CRLF normalization, timestamp formatting, and automatic UTF-8 / Windows-1252 character fallback). Shift timing dynamically by `+/-0.5s` using keyboard shortcuts.
- **Per-Person Voice Volume**: Dedicated volume slider next to each voice chat participant in the user list; levels persist seamlessly across member updates.

### Fullscreen & Immersion (Phase A)
- **In-Stage Reaction & Vote Tray**: Floating emoji and vote drawer located directly inside the video stage (`😀` button in controls) so reactions and votes remain fully accessible in fullscreen mode.
- **Fullscreen Chat Overlay**: Last 4 chat messages appear in the bottom-left of the video stage and gracefully fade out after 6 seconds.
- **Quick Fullscreen Chat Bar**: Press `Enter` while in fullscreen to pop up an in-stage chat prompt; type and press `Enter` to send, or `Esc` to dismiss.

### Interactivity & Engagement (Phase C)
- **Room Democratic Voting**: Any participant can initiate a vote (`⏪ Rewind 10s` or `⏸ Pause`). Votes run for 15 seconds, require a `>50%` majority, and carry a 30-second cooldown upon completion.
- **Reaction Heat Strip & Recap**: 10-second reaction buckets plotted dynamically along a heat strip above the progress bar. A "Recap" dialog surfaces the top 5 most reacted scenes (with click-to-seek support for hosts) and auto-opens when the movie ends.
- **Point-at-Screen Laser Pointer (`📍`)**: Click anywhere on the video stage to broadcast an animated, pulsing ping dot showing your name for 2.5 seconds (rate-limited to 4 pings/sec).

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Toggle Play / Pause |
| `←` / `→` | Seek backward / forward 10 seconds |
| `F` | Toggle Fullscreen |
| `M` | Toggle Mute |
| `,` / `.` | Shift subtitle timing by `-0.5s` / `+0.5s` |
| `Enter` | Open in-stage chat bar (when in fullscreen) |
| `Esc` | Close in-stage chat bar |

---

## Quick Start (Running Locally)

### Prerequisites

- Node.js 18 or newer
- npm

### Installation & Startup

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open your browser at `http://localhost:3000`.

---

## Exposing to Friends

### Option 1: Cloudflare Tunnel (Recommended)

You can instantly expose your local server to friends across the internet with an HTTPS URL using `cloudflared`:

```bash
cloudflared tunnel --url http://localhost:3000
```

> **Note on Cloudflare Free Tier:** Cloudflare's Terms of Service on free tunnels may restrict or throttle heavy video streaming. If you run into bandwidth limits, switch to **Local File Mode** where only synchronization signals and audio pass through the server.

### Option 2: Tailscale Funnel

If your group is on Tailscale or you want private mesh networking:

```bash
tailscale funnel 3000
```

---

## HTTPS & Microphone Access

WebRTC voice chat requires browser access to your microphone via `navigator.mediaDevices.getUserMedia`. Modern browsers enforce that `getUserMedia` is **only available in secure contexts**:
- `http://localhost` (or `http://127.0.0.1`)
- Any `https://` URL (provided automatically when using Cloudflare Tunnel or Tailscale Funnel)

Plain `http://` over a public IP or custom domain will block microphone access.

---

## Preparing Videos with FFmpeg

For maximum compatibility across all browsers (Chrome, Firefox, Safari, Edge) and fast seeking:

```bash
ffmpeg -i in.mkv -c:v libx264 -crf 23 -preset veryfast -vf scale=-2:720 -c:a aac -b:a 128k -movflags +faststart out.mp4
```

### Why these flags matter:
- `-c:v libx264 -c:a aac`: Encodes video as H.264 and audio as AAC, the standard format supported by HTML5 `<video>` tags everywhere.
- `-movflags +faststart`: Moves the `moov` atom (metadata index) to the beginning of the file, allowing playback and seeking to begin immediately before the entire file is buffered.
- `-vf scale=-2:720`: Scales video down to 720p to save upload bandwidth while maintaining quality.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the HTTP and Socket.IO server listens on |
| `MAX_UPLOAD_GB` | `8` | Maximum video upload size in gigabytes |
| `WAIT_MS` | `1500` | Milliseconds a client must buffer continuously before triggering auto-pause in "Wait for all" mode |
| `TURN_URL` | _None_ | Optional TURN server URLs (comma-separated, e.g. `turn:turn.example.com:3478`) |
| `TURN_USER` | _None_ | Username for TURN server authentication |
| `TURN_PASS` | _None_ | Password/credential for TURN server authentication |

---

## Testing

```bash
# Run server & socket protocol smoke test suite (Parts 1-6)
npm test

# Run Playwright browser end-to-end tests (Tests 1-6)
node test/e2e.mjs
```

---

## Deployment & Cloud Hosting (e.g. Render)

When deploying to platforms like **Render**, **Fly.io**, or **Railway**:
- **Ephemeral Storage**: Free and basic cloud tiers generally use ephemeral disks. Any uploaded movie files in the `uploads/` folder are erased whenever an instance restarts, spins down from inactivity, or deploys.
- **Bandwidth Limits**: Cloud hosts often impose tight egress bandwidth limits on free and hobby plans. Streaming multi-gigabyte video files to multiple viewers will quickly exhaust free allowances.

**Intended Setup**: Run the server directly on the host machine using **Cloudflare Tunnel** or use **Local File Mode** so no video bandwidth goes through cloud servers.
