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
  type Form477Stores,
  FULL_SCOPE,
  listCovered,
} from '@/services/open-data/mirror/stores.js';

/** Writes the mirror's coverage and integrity report. Returns false if any store failed its integrity check. */
export async function verifyMirror(
  stores: Form477Stores,
  writeLine: (line: string) => void,
): Promise<boolean> {
  let ok = true;
  for (const [name, store] of Object.entries(stores)) {
    const state = name === 'providerDim' ? undefined : await store.readState();
    const count = await store.count();
    const integrity = await store.integrityCheck();
    if (!integrity.ok) ok = false;
    writeLine(
      `${name.padEnd(16)} status=${(state?.status ?? 'derived').padEnd(11)} rows=${String(count).padStart(10)} ` +
        `integrity=${integrity.ok ? 'ok' : `FAILED (${integrity.results.join('; ')})`}` +
        (state?.error ? ` lastError=${state.error}` : ''),
    );
  }

  const covered = await listCovered(stores.deployment);
  const coveredStates = covered
    .filter((s) => s.startsWith('state:'))
    .map((s) => s.slice('state:'.length));
  const full = covered.includes(FULL_SCOPE);

  writeLine(
    `\nCovered states (${coveredStates.length}/${ALL_STATE_FIPS.length}): ` +
      (coveredStates.map((f) => `${f}=${STATE_FIPS_TO_ABBR[f] ?? '?'}`).join(' ') || 'none'),
  );
  writeLine(`Full-corpus marker: ${full ? 'present' : 'absent'}`);
  writeLine(
    full
      ? 'The mirror covers June 2021 block, area and provider data nationwide.'
      : 'The mirror covers June 2021 block and area data in the listed states. Provider queries and areas without a state prefix use FCC Open Data until full coverage.',
  );
  writeLine('Earlier Area Tables and geography names use FCC Open Data.');
  return ok;
}

if (import.meta.main) {
  const { mirrorPath } = getServerConfig();
  const stores = createForm477Stores(mirrorPath);
  try {
    console.log(`Mirror directory: ${mirrorPath}\n`);
    process.exitCode = (await verifyMirror(stores, console.log)) ? 0 : 1;
  } finally {
    await closeForm477Stores(stores);
  }
}
