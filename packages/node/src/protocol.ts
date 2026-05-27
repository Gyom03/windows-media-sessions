/**
 * Wire protocol shared with the .NET backend. Keep in sync with
 * `packages/backend/Protocol.cs`. Versioned via {@link PROTOCOL_VERSION};
 * the host refuses to talk to a backend with a different version.
 */

import type { MediaSession } from './types.js';

export const PROTOCOL_VERSION = 1;

export interface ReadyMessage {
  type: 'ready';
  version: string;
  protocol: number;
}

export interface SessionsMessage {
  type: 'sessions';
  sessions: MediaSession[];
  currentSessionId?: string | null;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  fatal?: boolean;
}

export type BackendMessage = ReadyMessage | SessionsMessage | ErrorMessage;

/**
 * Narrow-and-validate a raw JSON value into a {@link BackendMessage}. We are
 * deliberately defensive here — the backend is trusted but malformed bytes
 * are possible if the process is crashing mid-write.
 */
export function parseBackendMessage(value: unknown): BackendMessage | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { type?: unknown };
  switch (v.type) {
    case 'ready': {
      const m = value as Partial<ReadyMessage>;
      if (typeof m.version !== 'string' || typeof m.protocol !== 'number') return null;
      return { type: 'ready', version: m.version, protocol: m.protocol };
    }
    case 'sessions': {
      const m = value as Partial<SessionsMessage>;
      if (!Array.isArray(m.sessions)) return null;
      return {
        type: 'sessions',
        sessions: m.sessions as MediaSession[],
        currentSessionId: typeof m.currentSessionId === 'string' ? m.currentSessionId : null,
      };
    }
    case 'error': {
      const m = value as Partial<ErrorMessage>;
      if (typeof m.message !== 'string') return null;
      return { type: 'error', message: m.message, fatal: Boolean(m.fatal) };
    }
    default:
      return null;
  }
}
