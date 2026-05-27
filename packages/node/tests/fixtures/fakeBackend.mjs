#!/usr/bin/env node
// Test double for the .NET backend. Reads scripted JSON lines from
// $FAKE_BACKEND_SCRIPT and writes them to stdout one per line, with an
// optional delay (ms) prefix like "DELAY:50\n".
//
// Used by manager.test.ts to exercise the BackendProcess + SessionManager
// stack without a real Windows runtime.

import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const scriptPath = process.env.FAKE_BACKEND_SCRIPT;
if (!scriptPath) {
  process.stderr.write('FAKE_BACKEND_SCRIPT env var is required\n');
  process.exit(1);
}

const lines = readFileSync(scriptPath, 'utf8').split('\n');

(async () => {
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith('DELAY:')) {
      await delay(Number(line.slice('DELAY:'.length)));
      continue;
    }
    process.stdout.write(line + '\n');
  }
  // Stay alive until stdin closes or an "exit" line arrives, mimicking the
  // real backend's lifecycle.
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (chunk.toString().trim() === 'exit') process.exit(0);
  });
  process.stdin.on('end', () => process.exit(0));
})();
