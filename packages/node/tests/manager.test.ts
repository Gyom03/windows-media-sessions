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
