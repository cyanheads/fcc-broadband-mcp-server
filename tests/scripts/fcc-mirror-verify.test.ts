/**
 * @fileoverview Checks the mirror verification CLI against real SQLite stores.
 * @module tests/scripts/fcc-mirror-verify.test
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  closeForm477Stores,
  createForm477Stores,
  FULL_SCOPE,
  markCovered,
  stateScope,
} from '@/services/open-data/mirror/stores.js';
import { verifyMirror } from '../../scripts/fcc-mirror-verify.js';

it('reports state coverage, provider-dimension rows and integrity before and after full coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fcc-verify-'));
  const stores = createForm477Stores(dir);
  const verify = async () => {
    const lines: string[] = [];
    expect(await verifyMirror(stores, (line) => lines.push(line))).toBe(true);
    return lines.join('\n');
  };
  try {
    await markCovered(stores.deployment, stateScope('53'));
    await stores.providerDim.applyBatch(
      [
        {
          combo: '1|WA|50',
          hoconum: '1',
          holdingcompanyname: 'Example',
          stateabbr: 'WA',
          techcode: '50',
        },
      ],
      [],
    );
    const partial = await verify();
    expect(partial).toContain('Covered states (1/56): 53=WA');
    expect(partial).toContain('Full-corpus marker: absent');
    expect(partial).toContain(
      'Provider queries and areas without a state prefix use FCC Open Data until full coverage.',
    );
    expect(partial).toMatch(/providerDim\s+status=derived\s+rows=\s*1 integrity=ok/);
    expect(partial).toContain('Earlier Area Tables and geography names use FCC Open Data.');

    await markCovered(stores.deployment, FULL_SCOPE);
    const full = await verify();
    expect(full).toContain('Full-corpus marker: present');
    expect(full).toContain('The mirror covers June 2021 block, area and provider data nationwide.');
    expect(full).toMatch(/deployment\s+status=pending\s+rows=\s*0 integrity=ok/);
    expect(full).toMatch(/providerDim\s+status=derived\s+rows=\s*1 integrity=ok/);
    expect(full).toContain('Earlier Area Tables and geography names use FCC Open Data.');
  } finally {
    await closeForm477Stores(stores);
    await rm(dir, { recursive: true, force: true });
  }
});
