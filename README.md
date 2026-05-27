# windows-media-sessions

Read every active media session that Windows knows about — the same data that
powers the media keys on your keyboard, the volume flyout, and the lock
screen. Pure stdio bridge to a self-contained .NET 8 backend; no native node
addons, no `node-gyp`, no rebuild on `npm install`.

- Works on Windows 10 (1809+) and 11
- Ships ESM + CommonJS + full TypeScript typings
- Album art (thumbnail) returned as a ready-to-use base64 data URL
- Friendly app names resolved from AUMIDs (`"Spotify"`, `"Mozilla Firefox"`, ...)
- Live updates: track changes, play/pause, position, volume controls
- Crash-resistant: backend respawns with exponential backoff
- Compatible with Electron's main process

## Install

```sh
npm install windows-media-sessions
```

> Requires Windows 10 build 17763+ and Node 20+. The package declares
> `"os": ["win32"]` — install on Linux/macOS will fail by design.

## Quick start

```ts
import {
  getAllSessions,
  getActiveSessions,
  onSessionsChanged,
} from 'windows-media-sessions';

// Snapshot of every session Windows tracks
const all = await getAllSessions();

// Subset currently playing
const playing = await getActiveSessions();
for (const s of playing) {
  console.log(`${s.sourceAppDisplayName} — ${s.artist} — ${s.title}`);
}

// Live updates
const stop = onSessionsChanged((sessions) => {
  console.log(`${sessions.length} session(s)`);
});
// stop() to unsubscribe
```

## API

| Function | Signature | What it does |
| --- | --- | --- |
| `getAllSessions()` | `() => Promise<MediaSession[]>` | All Windows media sessions (playing, paused, stopped, ...). |
| `getActiveSessions()` | `() => Promise<MediaSession[]>` | Only the ones with `playbackStatus === 'playing'`. |
| `onSessionsChanged(cb)` | `(cb: (sessions: readonly MediaSession[]) => void) => Unsubscribe` | Live stream of every snapshot. Returns a function that unsubscribes the listener. |
| `shutdown()` | `() => Promise<void>` | Kills the backend `.exe` and frees the internal singleton. Optional — mainly for Electron's `before-quit` and tests. |
| `createSessionManager(options?)` | `(opts?: SessionManagerOptions) => SessionManager` | Advanced escape hatch: builds an isolated manager (custom backend path, non-default debounce, ...). Bypasses the singleton. |

### Types

```ts
type PlaybackStatus =
  | 'closed' | 'opened' | 'changing'
  | 'stopped' | 'playing' | 'paused';

interface MediaSession {
  id: string;
  sourceAppUserModelId: string;
  sourceAppDisplayName?: string;   // e.g. "Spotify", "Mozilla Firefox"
  title?: string;
  artist?: string;
  albumTitle?: string;
  genres?: string[];
  playbackStatus: PlaybackStatus;
  timeline?: { positionMs?: number; durationMs?: number };
  controls?: {
    canPlay: boolean;
    canPause: boolean;
    canSkipNext: boolean;
    canSkipPrevious: boolean;
  };
  thumbnail?: string;              // data:image/jpeg;base64,...
}
```

`thumbnail` is a ready-to-use data URL — pass it straight to `<img src>`:

```ts
const s = (await getActiveSessions())[0];
document.querySelector('img')!.src = s?.thumbnail ?? '';
```

## Common patterns

**Filter the live stream to "real" changes only** (skip position ticks):

```ts
import { onSessionsChanged, type MediaSession } from 'windows-media-sessions';

const fingerprint = (sessions: readonly MediaSession[]) =>
  JSON.stringify(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      status: s.playbackStatus,
    })),
  );

let last = '';
onSessionsChanged((sessions) => {
  const fp = fingerprint(sessions);
  if (fp === last) return; // only timeline changed
  last = fp;
  // ...
});
```

**Electron main process**:

```ts
import { app, ipcMain, BrowserWindow } from 'electron';
import { onSessionsChanged, shutdown } from 'windows-media-sessions';

app.whenReady().then(() => {
  const win = new BrowserWindow({ /* ... */ });
  onSessionsChanged((sessions) => {
    win.webContents.send('sessions', sessions);
  });
});

app.on('before-quit', () => shutdown());
```

## How it works

```
┌──────────────────────────┐                ┌──────────────────────────────┐
│ Node.js host             │   stdio JSON   │ .NET 8 backend (Win10+)      │
│ (windows-media-sessions) │ ────────────▶  │ GSMTC SessionManager events  │
│                          │ ◀────────────  │ → line-delimited snapshots    │
└──────────────────────────┘                └──────────────────────────────┘
```

The package ships a self-contained `windows-media-sessions-backend.exe`
(~15 MB) under `bin/win-x64/`. On the first API call, Node spawns the .exe
and listens for **line-delimited JSON** on stdout. The backend hooks
`GlobalSystemMediaTransportControlsSessionManager` and re-emits a full
snapshot whenever anything changes — track, play state, position, thumbnail.

See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) for the wire contract.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Backend executable not found` | Install missed the binary, or you cloned the repo and forgot `npm run build:backend`. Override path with `WINDOWS_MEDIA_SESSIONS_BACKEND=path\to\backend.exe`. |
| Empty session list | Most apps register an SMTC session only when they start playing. Hit play in Spotify / Edge / YouTube first. |
| `sourceAppDisplayName: undefined` | The AUMID isn't registered in the Start menu's app folder. The AUMID itself is still in `sourceAppUserModelId`; fall back to it for display. |
| Linux / macOS install fails | Unsupported — `"os": ["win32"]` in package.json. |
| Console spammed every ~1s | That's `TimelinePropertiesChanged` firing on position ticks. Filter on a fingerprint of non-timeline fields (see "Common patterns" above). |

## Local development

```pwsh
npm run build:backend   # 1. Compiles the .NET 8 backend (needs .NET 8 SDK)
npm run build:node      # 2. tsup build for the TS package
npm run build           # 1 + 2
npm test                # vitest
npx tsx packages/node/examples/watch.ts   # live demo
```

Repo layout:

```
.
├─ packages/
│  ├─ node/       # The npm package (windows-media-sessions)
│  └─ backend/    # .NET 8 source for the bundled executable
├─ scripts/       # build-backend.ps1, publish.ps1
├─ docs/PROTOCOL.md
└─ .github/workflows/ci.yml
```

## License

MIT
