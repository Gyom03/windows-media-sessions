/**
 * Public entry point for the windows-media-sessions package.
 *
 *   import { getAllSessions, getActiveSessions, onSessionsChanged } from "windows-media-sessions";
 *
 * A single internal {@link SessionManager} instance backs all functions so the
 * .NET backend is spawned at most once per Node process.
 */

import { SessionManager, type SessionManagerOptions } from './manager.js';
import type { MediaSession, SessionsChangedCallback, Unsubscribe } from './types.js';

export type {
  MediaSession,
  MediaTimeline,
  MediaControls,
  PlaybackStatus,
  SessionsChangedCallback,
  Unsubscribe,
} from './types.js';

let singleton: SessionManager | null = null;

function getManager(): SessionManager {
  if (process.platform !== 'win32') {
    throw new Error(
      `windows-media-sessions only runs on Windows (current platform: ${process.platform}).`,
    );
  }
  if (!singleton) singleton = new SessionManager();
  return singleton;
}

/**
 * Return a snapshot of every media session Windows is currently tracking,
 * regardless of playback state (playing, paused, stopped, ...).
 * The promise resolves once the backend has completed its initial handshake.
 */
export async function getAllSessions(): Promise<MediaSession[]> {
  return getManager().getAllSessions();
}

/**
 * Return only the sessions that are currently in the `'playing'` state.
 * Equivalent to filtering {@link getAllSessions} on `playbackStatus === 'playing'`.
 */
export async function getActiveSessions(): Promise<MediaSession[]> {
  return getManager().getActiveSessions();
}

/**
 * Subscribe to session changes. The callback is invoked with a fresh array
 * whenever the backend emits a new snapshot (debounced on both sides).
 *
 * Returns a function that unsubscribes the listener. Calling it more than
 * once is a no-op.
 */
export function onSessionsChanged(callback: SessionsChangedCallback): Unsubscribe {
  return getManager().onSessionsChanged(callback);
}

/**
 * Stop the backend process and dispose the internal manager. Mainly useful
 * for tests and for clean Electron shutdown — most consumers never need to
 * call this.
 */
export async function shutdown(): Promise<void> {
  if (!singleton) return;
  await singleton.stop();
  singleton = null;
}

/**
 * Escape hatch for advanced use cases (tests, custom backend builds, ...).
 * Construct your own manager with non-default options.
 */
export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  return new SessionManager(options);
}

export { SessionManager };
export type { SessionManagerOptions } from './manager.js';
