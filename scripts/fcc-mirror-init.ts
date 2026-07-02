/**
 * @fileoverview One-time bootstrap for the local Form 477 mirror. Runs
 * out-of-band (never on server startup): pages the frozen June 2021 corpus from
 * the Socrata CSV export into SQLite files under FCC_MIRROR_PATH.
 *
 * Usage:
 *   bun run mirror:init -- --states 11,53   # ingest specific states (2-digit FIPS)
 *   bun run mirror:init -- --full           # ingest the whole corpus (~9 GB, hours)
 *
 * Idempotent and resumable: already-covered states are skipped and an
 * interrupted state resumes from its persisted cursor on the next run. The
 * corpus is frozen, so there is no refresh mode.
 * @module scripts/fcc-mirror-init
 */

import { getServerConfig } from '@/config/server-config.js';
import { runMirrorInit } from '@/services/open-data/mirror/ingest.js';
import { ALL_STATE_FIPS, STATE_FIPS_TO_ABBR } from '@/services/open-data/mirror/state-fips.js';
import { closeForm477Stores, createForm477Stores } from '@/services/open-data/mirror/stores.js';

function usage(): never {
  console.log(`Usage:
  bun run mirror:init -- --states <fips,fips,...>   Ingest specific states (2-digit FIPS, e.g. 11,53)
  bun run mirror:init -- --full                     Ingest the full corpus (~9 GB download, hours-scale)

Valid state FIPS: ${ALL_STATE_FIPS.map((f) => `${f}=${STATE_FIPS_TO_ABBR[f]}`).join(' ')}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const full = args.includes('--full');
const statesIdx = args.indexOf('--states');
const statesArg = statesIdx !== -1 ? args[statesIdx + 1] : undefined;

if (full === Boolean(statesArg)) usage(); // exactly one of --full / --states

const states = full
  ? ('full' as const)
  : (statesArg as string)
      .split(',')
      .map((s) => s.trim().padStart(2, '0'))
      .filter(Boolean);

const config = getServerConfig();
const stores = createForm477Stores(config.mirrorPath);

const controller = new AbortController();
process.on('SIGINT', () => {
  console.error('\nInterrupted — persisting resume cursor. Re-run to continue.');
  controller.abort();
});

const log = {
  info: (msg: string, meta?: object) => console.log(`[mirror:init] ${msg}`, meta ?? ''),
  error: (msg: string, meta?: object) => console.error(`[mirror:init] ${msg}`, meta ?? ''),
};

console.log(`[mirror:init] Mirror directory: ${config.mirrorPath}`);
console.log(
  `[mirror:init] Mode: ${full ? 'full corpus' : `states ${(states as string[]).join(', ')}`}`,
);

try {
  const result = await runMirrorInit({
    stores,
    states,
    appToken: config.opendataAppToken,
    log,
    signal: controller.signal,
  });
  console.log(
    `[mirror:init] Done. Ingested: [${result.statesIngested.join(', ') || 'none'}], ` +
      `already covered: [${result.statesSkipped.join(', ') || 'none'}], ` +
      `full corpus marker: ${result.full}`,
  );
  console.log('[mirror:init] Set FCC_MIRROR_ENABLED=true to serve covered queries locally.');
} finally {
  await closeForm477Stores(stores);
}
