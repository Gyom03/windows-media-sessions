# windows-media-sessions

Read every active media session that Windows knows about — the same data that
powers the media keys on your keyboard, the volume flyout, and the lock screen.

- Pure stdio bridge to a **self-contained .NET 8 backend** — no native node
  addons, no `node-gyp`, no rebuild step on `npm install`.
- Works under **CommonJS and ESM**, ships full TypeScript typings.
- Streams live updates (`SessionsChanged`, `MediaPropertiesChanged`,
  `PlaybackInfoChanged`, `TimelinePropertiesChanged`).
- Crash-resistant: the backend is respawned with exponential backoff if it dies.
- Compatible with Electron's main process.

## Install

```sh
npm install windows-media-sessions
```

> Requires Windows 10 build 17763+ (the GSMTC API minimum) and Node 20+.

## Usage

```ts
import {
  getAllSessions,
  getActiveSessions,
  onSessionsChanged,
} from 'windows-media-sessions';

// Every session Windows knows about, regardless of state.
const all = await getAllSessions();
console.log(all);

// Only the sessions currently in 'playing' state.
const active = await getActiveSessions();
for (const s of active) {
  console.log(s.sourceAppDisplayName, '—', s.title);
}

// Stream live updates
const stop = onSessionsChanged((sessions) => {
  console.log(`${sessions.length} session(s)`);
});

// Later…
stop();
```

## API

### `getAllSessions(): Promise<MediaSession[]>`

Resolves with a snapshot of every session Windows is currently tracking,
regardless of `playbackStatus` (playing, paused, stopped, ...).

### `getActiveSessions(): Promise<MediaSession[]>`

Resolves with the subset of sessions whose `playbackStatus === 'playing'`.
Equivalent to filtering `getAllSessions()` manually.

### `onSessionsChanged(cb): Unsubscribe`

Subscribes to live updates. The callback fires with a fresh array on every
backend snapshot (debounced). Returns a function that detaches the listener.

### `shutdown(): Promise<void>`

Stops the backend and disposes the internal manager. Most apps never need to
call this; Electron apps may want to invoke it on `before-quit`.

### Types

```ts
type PlaybackStatus =
  | 'closed' | 'opened' | 'changing'
  | 'stopped' | 'playing' | 'paused';

interface MediaSession {
  id: string;
  sourceAppUserModelId: string;
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
}
```

## How it works

The package ships a tiny `windows-media-sessions-backend.exe` (a self-contained
.NET 8 single-file binary, ~15 MB) under `bin/win-x64/`. On the first API call
Node spawns the executable and listens for **line-delimited JSON** on its
stdout. The backend hooks the Windows
`GlobalSystemMediaTransportControlsSessionManager` and re-emits a full snapshot
each time anything changes. See [docs/PROTOCOL.md](../../docs/PROTOCOL.md) for
the wire contract.

## Electron

Works out of the box in the main process. Forward to the renderer through
`ipcMain` / `contextBridge` like any other Node API. Pair with `onSessionsChanged`
plus `webContents.send('sessions', …)` to drive a now-playing widget.

## Troubleshooting

- **`Backend executable not found`** — install missed the binary, or you cloned
  the repo without running `npm run build:backend`. Point at a custom binary
  via `WINDOWS_MEDIA_SESSIONS_BACKEND=path\to\backend.exe`.
- **Empty session list** — most apps register an SMTC session only when they
  start playing. Hit play in Spotify / Edge / Groove first.
- **Linux / macOS** — unsupported. The package errors out on import.

## License

MIT
