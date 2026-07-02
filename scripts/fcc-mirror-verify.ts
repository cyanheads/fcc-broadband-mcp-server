/**
 * @fileoverview Verifies the local Form 477 mirror: per-store sync state, row
 * counts, SQLite integrity checks, and the coverage roster (which states are
 * fully ingested, whether the full-corpus marker is present).
 *
 * Usage: bun run mirror:verify
 * @module scripts/fcc-mirror-verify
 */

import { getServerConfig } from '@/config/server-config.js';
import { ALL_STATE_FIPS, STATE_FIPS_TO_ABBR } from '@/services/open-data/mirror/state-fips.js';
import {
  closeForm477Stores,
  createForm477Stores,
  FULL_SCOPE,
  listCovered,
} from '@/services/open-data/mirror/stores.js';

const config = getServerConfig();
const stores = createForm477Stores(config.mirrorPath);

console.log(`Mirror directory: ${config.mirrorPath}\n`);

let ok = true;
try {
  for (const [name, store] of Object.entries(stores)) {
    const state = await store.readState();
    const count = await store.count();
    const integrity = await store.integrityCheck();
    if (!integrity.ok) ok = false;
    console.log(
      `${name.padEnd(16)} status=${state.status.padEnd(11)} rows=${String(count).padStart(10)} ` +
        `integrity=${integrity.ok ? 'ok' : `FAILED (${integrity.results.join('; ')})`}` +
        (state.error ? ` lastError=${state.error}` : ''),
    );
  }

  const covered = await listCovered(stores.deployment);
  const coveredStates = covered
    .filter((s) => s.startsWith('state:'))
    .map((s) => s.slice('state:'.length));
  const full = covered.includes(FULL_SCOPE);

  console.log(
    `\nCovered states (${coveredStates.length}/${ALL_STATE_FIPS.length}): ` +
      (coveredStates.map((f) => `${f}=${STATE_FIPS_TO_ABBR[f] ?? '?'}`).join(' ') || 'none'),
  );
  console.log(`Full-corpus marker: ${full ? 'present' : 'absent'}`);
  console.log(
    full
      ? 'All Form 477 queries (including provider search/summary) serve from the mirror.'
      : 'Provider search/summary and non-state geographies (cbsa/tribal/nation) serve live until the full corpus is ingested.',
  );
} finally {
  await closeForm477Stores(stores);
}

process.exit(ok ? 0 : 1);
