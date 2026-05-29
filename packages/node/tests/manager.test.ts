import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionManager } from '../src/manager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeBackend = path.join(here, 'fixtures', 'fakeBackend.mjs');

function makeScript(lines: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wms-test-'));
  const file = path.join(dir, 'script.txt');
  writeFileSync(file, lines.join('\n'));
  return file;
}

describe('SessionManager (integration with fake backend)', () => {
  let manager: SessionManager | null = null;
  let scriptDir: string | null = null;

  afterEach(async () => {
    await manager?.stop();
    manager = null;
    if (scriptDir) {
      rmSync(path.dirname(scriptDir), { recursive: true, force: true });
      scriptDir = null;
    }
  });

  it('exposes sessions after handshake', async () => {
    const session = {
      id: 'Spotify.exe',
      sourceAppUserModelId: 'Spotify.exe',
      title: 'Test Track',
      artist: 'Test Artist',
      playbackStatus: 'playing',
    };
    const script = makeScript([
      JSON.stringify({ type: 'ready', version: '1.0.0', protocol: 1 }),
      JSON.stringify({ type: 'sessions', sessions: [session], currentSessionId: session.id }),
    ]);
    scriptDir = script;

    manager = new SessionManager({
      backendPath: process.execPath,
      spawnArgs: [fakeBackend],
    });
    Object.assign(process.env, { FAKE_BACKEND_SCRIPT: script });

    const sessions = await manager.getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe('Test Track');

    const active = await manager.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('Spotify.exe');
  });

  it('notifies subscribers on subsequent snapshots', async () => {
    const script = makeScript([
      JSON.stringify({ type: 'ready', version: '1.0.0', protocol: 1 }),
      JSON.stringify({ type: 'sessions', sessions: [] }),
      'DELAY:30',
      JSON.stringify({
        type: 'sessions',
        sessions: [
          {
            id: 'A',
            sourceAppUserModelId: 'A',
            playbackStatus: 'paused',
          },
        ],
        currentSessionId: 'A',
      }),
    ]);
    scriptDir = script;

    manager = new SessionManager({
      backendPath: process.execPath,
      spawnArgs: [fakeBackend],
      notifyDebounceMs: 5,
    });
    Object.assign(process.env, { FAKE_BACKEND_SCRIPT: script });

    const received: number[] = [];
    manager.onSessionsChanged((sessions) => received.push(sessions.length));
    await manager.getAllSessions(); // wait for handshake + first snapshot
    await new Promise((r) => setTimeout(r, 150));

    expect(received).toContain(1);
  });

  it('routes non-fatal backend errors to diagnostic, never error, and keeps the feed alive', async () => {
    const script = makeScript([
      JSON.stringify({ type: 'ready', version: '1.0.0', protocol: 1 }),
      JSON.stringify({ type: 'sessions', sessions: [] }),
      // A non-fatal diagnostic (e.g. an app quitting without a thumbnail).
      JSON.stringify({
        type: 'error',
        message: '[Spotify] thumbnail: source app did not provide one',
        fatal: false,
      }),
      'DELAY:20',
      // The feed must keep flowing after the diagnostic.
      JSON.stringify({
        type: 'sessions',
        sessions: [{ id: 'A', sourceAppUserModelId: 'A', playbackStatus: 'paused' }],
        currentSessionId: 'A',
      }),
    ]);
    scriptDir = script;

    manager = new SessionManager({
      backendPath: process.execPath,
      spawnArgs: [fakeBackend],
      notifyDebounceMs: 5,
    });
    Object.assign(process.env, { FAKE_BACKEND_SCRIPT: script });

    const errors: Error[] = [];
    const diagnostics: Error[] = [];
    manager.on('error', (e) => errors.push(e));
    manager.on('diagnostic', (e) => diagnostics.push(e));

    const received: number[] = [];
    manager.onSessionsChanged((sessions) => received.push(sessions.length));
    await manager.getAllSessions();
    await new Promise((r) => setTimeout(r, 200));

    expect(diagnostics.some((e) => /thumbnail/i.test(e.message))).toBe(true);
    expect(errors).toHaveLength(0);
    // The post-diagnostic snapshot still arrived → the read loop survived.
    expect(received).toContain(1);
  });

  it('does not throw when a non-fatal error arrives with no error listener', async () => {
    const script = makeScript([
      JSON.stringify({ type: 'ready', version: '1.0.0', protocol: 1 }),
      JSON.stringify({ type: 'sessions', sessions: [] }),
      JSON.stringify({ type: 'error', message: 'no thumbnail', fatal: false }),
      'DELAY:20',
      JSON.stringify({
        type: 'sessions',
        sessions: [{ id: 'A', sourceAppUserModelId: 'A', playbackStatus: 'paused' }],
        currentSessionId: 'A',
      }),
    ]);
    scriptDir = script;

    manager = new SessionManager({
      backendPath: process.execPath,
      spawnArgs: [fakeBackend],
      notifyDebounceMs: 5,
    });
    Object.assign(process.env, { FAKE_BACKEND_SCRIPT: script });

    // Deliberately attach NO 'error' listener — this is the scenario that used
    // to throw inside the stdout handler and kill the session feed.
    const received: number[] = [];
    manager.onSessionsChanged((sessions) => received.push(sessions.length));
    await manager.getAllSessions();
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toContain(1);
  });

  it('rejects a protocol mismatch with an error event', async () => {
    const script = makeScript([
      JSON.stringify({ type: 'ready', version: '1.0.0', protocol: 999 }),
    ]);
    scriptDir = script;

    manager = new SessionManager({
      backendPath: process.execPath,
      spawnArgs: [fakeBackend],
    });
    Object.assign(process.env, { FAKE_BACKEND_SCRIPT: script });

    const errors: Error[] = [];
    manager.on('error', (e) => errors.push(e));
    manager.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(errors.some((e) => /protocol mismatch/i.test(e.message))).toBe(true);
  });
});
