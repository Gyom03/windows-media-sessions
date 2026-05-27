/**
 * Stream live media session updates until Ctrl+C.
 *   npx tsx examples/watch.ts
 */

import { onSessionsChanged, shutdown } from '../src/index.js';

const unsubscribe = onSessionsChanged((sessions) => {
  console.clear();
  console.log(`[${new Date().toISOString()}] ${sessions.length} session(s)`);
  for (const s of sessions) {
    const pos = s.timeline?.positionMs ? Math.floor(s.timeline.positionMs / 1000) : 0;
    const dur = s.timeline?.durationMs ? Math.floor(s.timeline.durationMs / 1000) : 0;
    console.log(
      `  [${s.playbackStatus.padEnd(7)}] ${(s.artist ?? '?').padEnd(20)} — ${s.title ?? '?'} (${pos}/${dur}s)`,
    );
  }
});

process.on('SIGINT', async () => {
  unsubscribe();
  await shutdown();
  process.exit(0);
});

// Keep the event loop alive.
setInterval(() => {}, 1_000_000);
