/**
 * Public types for the windows-media-sessions package.
 *
 * These types mirror the JSON DTOs produced by the .NET backend. Any
 * change here must be made in lockstep with `packages/backend/Protocol.cs`.
 */

/** Mirrors {@link https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionplaybackstatus | GSMTC PlaybackStatus}. */
export type PlaybackStatus =
  | 'closed'
  | 'opened'
  | 'changing'
  | 'stopped'
  | 'playing'
  | 'paused';

export interface MediaTimeline {
  /** Current playback position in milliseconds. */
  positionMs?: number;
  /** Total media duration in milliseconds. */
  durationMs?: number;
}

export interface MediaControls {
  canPlay: boolean;
  canPause: boolean;
  canSkipNext: boolean;
  canSkipPrevious: boolean;
}

export interface MediaSession {
  /**
   * Stable identifier for the session within the current Windows session.
   * Currently derived from the source app's User Model ID, which is unique
   * per app but does not survive a Windows reboot.
   */
  id: string;
  /** The AUMID of the app owning the session (e.g. `Spotify.exe`). */
  sourceAppUserModelId: string;
  /**
   * Friendly app name resolved by Windows from the AUMID (e.g. "Spotify",
   * "Mozilla Firefox"). Undefined when Windows can't resolve the AUMID —
   * fall back to `sourceAppUserModelId` for display purposes.
   */
  sourceAppDisplayName?: string;
  title?: string;
  artist?: string;
  albumTitle?: string;
  genres?: string[];
  playbackStatus: PlaybackStatus;
  timeline?: MediaTimeline;
  controls?: MediaControls;
  /**
   * Album / track art as a base64 data URL (e.g.
   * `data:image/jpeg;base64,/9j/4AAQ...`). Directly usable as `<img src>` in a
   * browser or Electron renderer. Undefined when the source app doesn't
   * publish a thumbnail.
   */
  thumbnail?: string;
}

/** Callback type for {@link onSessionsChanged}. */
export type SessionsChangedCallback = (sessions: readonly MediaSession[]) => void;

/** Disposer returned by {@link onSessionsChanged}. */
export type Unsubscribe = () => void;
