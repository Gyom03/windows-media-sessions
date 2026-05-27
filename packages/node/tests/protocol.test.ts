import { describe, expect, it } from 'vitest';
import { parseBackendMessage } from '../src/protocol.js';

describe('parseBackendMessage', () => {
  it('parses a ready message', () => {
    expect(parseBackendMessage({ type: 'ready', version: '1.0.0', protocol: 1 })).toEqual({
      type: 'ready',
      version: '1.0.0',
      protocol: 1,
    });
  });

  it('parses an error message with optional fatal flag', () => {
    expect(parseBackendMessage({ type: 'error', message: 'boom' })).toEqual({
      type: 'error',
      message: 'boom',
      fatal: false,
    });
    expect(parseBackendMessage({ type: 'error', message: 'fatal', fatal: true })).toEqual({
      type: 'error',
      message: 'fatal',
      fatal: true,
    });
  });

  it('parses a sessions message and normalizes currentSessionId', () => {
    const out = parseBackendMessage({ type: 'sessions', sessions: [] });
    expect(out).toEqual({ type: 'sessions', sessions: [], currentSessionId: null });
  });

  it('rejects malformed messages', () => {
    expect(parseBackendMessage(null)).toBeNull();
    expect(parseBackendMessage('hello')).toBeNull();
    expect(parseBackendMessage({})).toBeNull();
    expect(parseBackendMessage({ type: 'unknown' })).toBeNull();
    expect(parseBackendMessage({ type: 'ready' })).toBeNull();
    expect(parseBackendMessage({ type: 'sessions', sessions: 'not-array' })).toBeNull();
  });
});
