# Backend protocol

The Node host and the .NET backend communicate through **line-delimited JSON**
over the backend's stdin/stdout. Each line is exactly one JSON object, encoded
as UTF-8, terminated by a single `\n` (no `\r`). The Node side splits on `\n`
and tolerates a stray trailing `\r`.

The protocol is bidirectional but **asymmetric**:

- The backend writes **messages** (objects with a `type` field).
- The host writes **commands** (plain strings).

Current protocol version: **1**. Mismatched versions are a hard error and the
host refuses to talk to the backend.

---

## Backend → host messages

### `ready`

Sent exactly once, immediately after process start.

```json
{ "type": "ready", "version": "0.1.0", "protocol": 1 }
```

| Field      | Type     | Notes                                                      |
| ---------- | -------- | ---------------------------------------------------------- |
| `version`  | `string` | Informational. Reflects the backend's assembly version.    |
| `protocol` | `number` | Wire protocol version. The host enforces equality with 1.  |

### `sessions`

Full snapshot. Sent whenever any session-related event fires (after debouncing).

```json
{
  "type": "sessions",
  "currentSessionId": "Spotify.exe",
  "sessions": [
    {
      "id": "Spotify.exe",
      "sourceAppUserModelId": "Spotify.exe",
      "title": "Black Hole Sun",
      "artist": "Soundgarden",
      "albumTitle": "Superunknown",
      "genres": ["Rock"],
      "playbackStatus": "playing",
      "timeline": { "positionMs": 84321, "durationMs": 320000 },
      "controls": {
        "canPlay": true, "canPause": true,
        "canSkipNext": true, "canSkipPrevious": true
      },
      "thumbnail": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
}
```

Notes:

- The list is **complete**, not a diff. The host replaces its cache wholesale.
- `currentSessionId` is the session Windows considers "active" for media keys.
  It is `null` when no session is elected.
- Optional fields (`title`, `artist`, `albumTitle`, `genres`, `timeline`,
  `controls`) are omitted when empty.

### `error`

Non-fatal diagnostic from the backend. The host re-emits it through the
`SessionManager`'s `error` event.

```json
{ "type": "error", "message": "TryGetMediaPropertiesAsync timed out", "fatal": false }
```

If `fatal` is `true` the backend will exit shortly after; the host's reconnect
policy will respawn it.

---

## Host → backend commands

Plain text, one per line:

| Line      | Effect                                                        |
| --------- | ------------------------------------------------------------- |
| `refresh` | Force-emit a fresh `sessions` snapshot (bypassing debouncing). |
| `exit`    | Graceful shutdown. The backend exits with status 0.            |

EOF on stdin is treated as `exit`.

---

## Debouncing

The backend coalesces all GSMTC events into snapshots emitted at most once
every **50ms**. The Node host applies a second, **25ms** debounce before
forwarding to user callbacks. The two layers handle different burst sources:

- Backend-side: bursts of `MediaPropertiesChanged` + `PlaybackInfoChanged` +
  `TimelinePropertiesChanged` that Windows fires on track change.
- Host-side: multiple snapshots received over the pipe in the same tick.

Both windows are tunable through `SessionManagerOptions.notifyDebounceMs` and
the constants at the top of `Program.cs`.
