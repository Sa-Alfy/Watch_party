# Watch Together 🍿🎬

Watch Together is a lightweight watch-party web application where a host uploads or links a video, and everyone watches together in real-time sync with WebRTC voice chat, live text chat, floating emojis, and flying comments.

Built with **Node 18+**, **Express 4**, **Socket.IO 4**, and **vanilla JavaScript** with zero build steps or frontend frameworks.

---

## Features

- **Authoritative Real-Time Sync**: Server-authoritative playback engine with adaptive drift correction (playbackRate micro-adjustments and seeking).
- **Chunked Resumable Uploads**: 4MB chunked upload pipeline with upload progress and resume support.
- **Three Movie Modes**:
  1. **Upload**: Stream an MP4/WebM video file directly from the host's machine.
  2. **Local File**: Zero-bandwidth mode where each participant selects their local copy of the same video file while the room synchronizes playback.
  3. **Direct Link**: Stream video directly from a public URL.
- **WebRTC Voice Chat**: Peer-to-peer mesh audio voice chat with speaking indicator rings and mic mute toggles.
- **Chat & Flying Screen Comments**: Live text chat with an option to fly comments across the video screen.
- **Live Reactions & Nudges**: Whitelisted emoji floaters and quick nudge alerts ("✋ Wait, pause!", "🚽 BRB").
- **Host Permission Controls**: Configurable playback permissions (`Host only` vs `Everyone`).

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
| `TURN_URL` | _None_ | Optional TURN server URLs (comma-separated, e.g. `turn:turn.example.com:3478`) |
| `TURN_USER` | _None_ | Username for TURN server authentication |
| `TURN_PASS` | _None_ | Password/credential for TURN server authentication |

---

## Deployment & Cloud Hosting (e.g. Render)

When deploying to platforms like **Render**, **Fly.io**, or **Railway**:
- **Ephemeral Storage**: Free and basic cloud tiers generally use ephemeral disks. Any uploaded movie files in the `uploads/` folder are erased whenever an instance restarts, spins down from inactivity, or deploys.
- **Bandwidth Limits**: Cloud hosts often impose tight egress bandwidth limits on free and hobby plans. Streaming multi-gigabyte video files to multiple viewers will quickly exhaust free allowances.

**Intended Setup**: Run the server directly on the host machine using **Cloudflare Tunnel** or use **Local File Mode** so no video bandwidth goes through cloud servers.
