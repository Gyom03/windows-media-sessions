/**
 * Owns the in-memory cache of active sessions and exposes the
 * package's three public APIs ({@link getSessions}, {@link getCurrentSession},
 * {@link onSessionsChanged}). The cache is fed from {@link BackendProcess}
 * messages and is the only place that reasons about session identity.
 */

import { EventEmitter } from 'node:events';

import { BackendProcess, type BackendProcessOptions } from './backend.js';
import { debounce } from './utils/debounce.js';
import type {
  MediaSession,
  SessionsChangedCallback,
  Unsubscribe,
} from './types.js';

export interface SessionManagerOptions extends BackendProcessOptions {
  /** Coalesce window for downstream `sessionsChanged` events, in ms. */
  notifyDebounceMs?: number;
}

interface SessionManagerEvents {
  sessionsChanged: (sessions: readonly MediaSession[]) => void;
  error: (err: Error) => void;
}

/**
 * Singleton-style controller. We don't expose the class to consumers — the
 * `index.ts` module instantiates exactly one and lets the public free functions
 * delegate to it. That keeps the public surface small and prevents accidental
 * multi-process spawning.
 */
export class SessionManager extends EventEmitter {
  private readonly backend: BackendProcess;
  private cache: readonly MediaSession[] = [];
  private started = false;
  private firstSnapshotPromise: Promise<void> | null = null;
  private resolveFirstSnapshot: (() => void) | null = null;
  private hasSnapshot = false;
  private readonly notify: ReturnType<typeof debounce<[readonly MediaSession[]]>>;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.backend = new BackendProcess(options);
    this.notify = debounce<[readonly MediaSession[]]>(
      (sessions) => this.emit('sessionsChanged', sessions),
      options.notifyDebounceMs ?? 25,
    );

    this.backend.on('message', (msg) => {
      if (msg.type === 'sessions') {
        // Replace the cache wholesale — the backend always sends a full
        // snapshot, so diffing here would be busywork.
        this.cache = Object.freeze(msg.sessions.slice());
        this.hasSnapshot = true;
        this.resolveFirstSnapshot?.();
        this.resolveFirstSnapshot = null;
        this.notify(this.cache);
      } else if (msg.type === 'error') {
        this.emit('error', new Error(msg.message));
      }
    });

    this.backend.on('exit', (code, signal) => {
      // Reset the first-snapshot latch — the next spawn must re-emit before
      // getSessions resolves.
      this.firstSnapshotPromise = null;
      this.hasSnapshot = false;
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Backend exited with code ${code} (signal=${signal ?? 'none'})`));
      }
    });

    this.backend.on('error', (err) => this.emit('error', err));
  }

  override on<E extends keyof SessionManagerEvents>(event: E, listener: SessionManagerEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<E extends keyof SessionManagerEvents>(
    event: E,
    ...args: Parameters<SessionManagerEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /** Lazily start the backend on the first public call. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.firstSnapshotPromise = new Promise<void>((resolve) => {
      this.resolveFirstSnapshot = resolve;
    });
    this.backend.start();
  }

  /**
   * Resolves once the backend has handshaken AND emitted its first snapshot
   * (which it always does immediately after `ready`, even when empty). After
   * this resolves the cache is authoritative.
   */
  async waitForReady(timeoutMs = 5000): Promise<void> {
    this.start();
    if (this.hasSnapshot) return;
    if (!this.firstSnapshotPromise) return;
    await Promise.race([
      this.firstSnapshotPromise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timed out waiting for first backend snapshot')),
          timeoutMs,
        ),
      ),
    ]);
  }

  /** Every media session Windows currently knows about, regardless of state. */
  async getAllSessions(): Promise<MediaSession[]> {
    await this.waitForReady();
    return this.cache.map((s) => cloneSession(s));
  }

  /** Subset of {@link getAllSessions} where playbackStatus === 'playing'. */
  async getActiveSessions(): Promise<MediaSession[]> {
    await this.waitForReady();
    return this.cache.filter((s) => s.playbackStatus === 'playing').map((s) => cloneSession(s));
  }

  onSessionsChanged(callback: SessionsChangedCallback): Unsubscribe {
    this.start();
    const wrapped: SessionsChangedCallback = (sessions) =>
      callback(sessions.map((s) => cloneSession(s)));
    this.on('sessionsChanged', wrapped);
    // If we already have data, emit it on the next tick so callers don't
    // miss the current state.
    if (this.cache.length > 0) {
      queueMicrotask(() => wrapped(this.cache));
    }
    return () => {
      this.off('sessionsChanged', wrapped as (...args: unknown[]) => void);
    };
  }

  async stop(): Promise<void> {
    this.notify.cancel();
    await this.backend.stop();
    this.started = false;
    this.firstSnapshotPromise = null;
    this.resolveFirstSnapshot = null;
    this.hasSnapshot = false;
    this.cache = [];
  }
}

/**
 * Deep-clone a session before handing it to user code. The internal cache is
 * frozen, but callers expect mutable plain objects.
 */
function cloneSession(s: MediaSession): MediaSession {
  return {
    id: s.id,
    sourceAppUserModelId: s.sourceAppUserModelId,
    sourceAppDisplayName: s.sourceAppDisplayName,
    title: s.title,
    artist: s.artist,
    albumTitle: s.albumTitle,
    genres: s.genres ? s.genres.slice() : undefined,
    playbackStatus: s.playbackStatus,
    timeline: s.timeline ? { ...s.timeline } : undefined,
    controls: s.controls ? { ...s.controls } : undefined,
    thumbnail: s.thumbnail,
  };
}
