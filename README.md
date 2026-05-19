# 🛋️ CouchSpace — Watch Together

Real-time watch party app. Sync video playback with friends across the internet.

## Features

- **Room hosting** — create public or private rooms
- **Password protection** — lock private rooms
- **Video sync** — play, pause, seek synced in real time for everyone
- **YouTube support** — paste any YouTube URL or video ID
- **Direct video** — paste MP4/WebM URLs
- **Host-only controls** — optionally lock playback to the host
- **Live chat** — with emoji reactions that float on screen
- **Typing indicators** — see who's typing
- **Auto host hand-off** — if the host leaves, the next viewer becomes host
- **Reconnect recovery** — rejoins the room automatically on reconnect

## Quick Start

```bash
npm install
npm start
```

Then open http://localhost:3000

## Dev mode (auto-restart on file change)

```bash
npm run dev
```

## Project Structure

```
couchspace/
├── server.js          # Express + Socket.io backend
├── public/
│   └── index.html     # All frontend (HTML/CSS/JS)
└── package.json
```

## How It Works

All state lives in-memory on the server (no database needed).

| Event | Direction | Description |
|---|---|---|
| `create_room` | client→server | Create a new room |
| `join_room` | client→server | Join existing room |
| `video_load/play/pause/seek` | both | Sync video state |
| `chat_message` | both | Chat |
| `emoji_reaction` | both | Floating emoji |
| `set_host_only` | client→server | Toggle host control mode |
| `host_changed` | server→client | New host assigned |
| `rooms_updated` | server→client | Public room list refresh |

## Deployment

Works on any Node.js host (Railway, Render, Fly.io, etc.). Set `PORT` env var if needed.
