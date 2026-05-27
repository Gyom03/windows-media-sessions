/**
 * Print a one-shot snapshot of all media sessions, then the currently-playing
 * subset.
 *   npx tsx examples/basic.ts
 */

import { getAllSessions, getActiveSessions, shutdown } from '../src/index.js';

const all = await getAllSessions();
console.log(`Found ${all.length} session(s) total:`);
for (const s of all) {
  console.log(
    `  [${s.playbackStatus}] ${s.sourceAppDisplayName ?? s.sourceAppUserModelId} — ${s.title ?? '?'}`,
  );
}

const active = await getActiveSessions();
console.log(`\n${active.length} currently playing:`);
for (const s of active) {
  console.log(`  ${s.sourceAppDisplayName ?? s.sourceAppUserModelId} — ${s.title ?? '?'}`);
}

await shutdown();
