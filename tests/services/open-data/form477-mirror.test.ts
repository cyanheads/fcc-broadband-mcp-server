/**
 * @fileoverview Tests for the Form 477 mirror routing and coverage gates:
 * mirror hits for covered states, silent live fallback for uncovered states,
 * full-corpus gating for cross-key aggregations, the state-prefix LIKE → range
 * rewrite, the provider-dimension query path, and byte-identical passthrough
 * when the mirror is absent. Stores are seeded in a temp directory through the
 * real store API with fixtures mirroring the live Socrata column names.
 * @module tests/services/open-data/form477-mirror.test
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import { FULL_SCOPE, markCovered, stateScope } from '@/services/open-data/mirror/stores.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';

const ctx: Context = createMockContext();

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function liveJson(rows: unknown[]): Response {
  return new Response(JSON.stringify(rows), { status: 200 });
}

function makeService(mirror?: Form477Mirror): OpenDataService {
  const serverConfig = { mirrorEnabled: Boolean(mirror), mirrorPath: 'unused' } as ServerConfig;
  return new OpenDataService(
    {} as unknown as AppConfig,
    {} as unknown as StorageService,
    serverConfig,
    mirror,
  );
}

/** Seed a mirror in a temp dir with DC (11) covered and WY (56) present but uncovered. */
async function seedMirror(dir: string): Promise<Form477Mirror> {
  const mirror = new Form477Mirror(dir);
  const { deployment, area, providerSummary, geography, providerDim } = mirror.stores;

  await deployment.applyBatch(
    [
      {
        sid: 'row-dc-1',
        blockcode: '110010001011000',
        provider_id: '80000',
        providername: 'Comcast of DC',
        holdingcompanyname: 'Comcast Corporation',
        hoconum: '130235',
        stateabbr: 'DC',
        techcode: '43',
        maxaddown: 987,
        maxadup: 35,
        consumer: '1',
        business: '0',
      },
      {
        sid: 'row-dc-2',
        blockcode: '110010001011000',
        provider_id: '80001',
        providername: 'Verizon DC',
        holdingcompanyname: 'Verizon Communications Inc.',
        hoconum: '131425',
        stateabbr: 'DC',
        techcode: '50',
        maxaddown: 1000,
        maxadup: 1000,
        consumer: '1',
        business: '1',
      },
      {
        sid: 'row-wy-1',
        blockcode: '560010001011000',
        provider_id: '80002',
        providername: 'Wyoming ISP',
        holdingcompanyname: 'Wyoming Holdings',
        hoconum: '999999',
        stateabbr: 'WY',
        techcode: '70',
        maxaddown: 25,
        maxadup: 3,
        consumer: '1',
        business: '0',
      },
    ],
    [],
  );

  await area.applyBatch(
    [
      {
        sid: 'area-1',
        type: 'county',
        id: '11001',
        tech: 'acfosw',
        speed: '25',
        urban_rural: 'U',
        tribal_non: 'N',
        has_0: '10',
        has_1: '20',
        has_2: '30',
        has_3more: '40',
      },
      {
        sid: 'area-2',
        type: 'county',
        id: '12001',
        tech: 'acfosw',
        speed: '25',
        urban_rural: 'U',
        tribal_non: 'N',
        has_0: '5',
        has_1: '5',
        has_2: '5',
        has_3more: '5',
      },
      {
        sid: 'area-3',
        type: 'nation',
        id: '0',
        tech: 'acfosw',
        speed: '25',
        urban_rural: 'U',
        tribal_non: 'N',
        has_0: '100',
        has_1: '200',
        has_2: '300',
        has_3more: '400',
      },
    ],
    [],
  );

  await providerDim.applyBatch(
    [
      {
        combo: '130235|DC|43',
        hoconum: '130235',
        holdingcompanyname: 'Comcast Corporation',
        stateabbr: 'DC',
        techcode: '43',
      },
      {
        combo: '130235|MD|43',
        hoconum: '130235',
        holdingcompanyname: 'Comcast Corporation',
        stateabbr: 'MD',
        techcode: '43',
      },
      {
        combo: '130235|DC|50',
        hoconum: '130235',
        holdingcompanyname: 'Comcast Corporation',
        stateabbr: 'DC',
        techcode: '50',
      },
      {
        combo: '131425|DC|50',
        hoconum: '131425',
        holdingcompanyname: 'Verizon Communications Inc.',
        stateabbr: 'DC',
        techcode: '50',
      },
    ],
    [],
  );

  await providerSummary.applyBatch(
    [
      {
        sid: 'ps-1',
        hoconum: '130235',
        tech: 'all',
        d_1: '100',
        d_2: '100',
        d_3: '90',
        d_4: '80',
        d_5: '70',
        d_6: '60',
        d_7: '50',
        d_8: '40',
      },
    ],
    [],
  );

  await geography.applyBatch(
    [
      { sid: 'geo-1', geoid: '11001', type: 'county', name: 'District of Columbia, DC' },
      { sid: 'geo-2', geoid: '56001', type: 'county', name: 'Albany County, WY' },
      { sid: 'geo-3', geoid: '31000', type: 'cbsa', name: 'Some Metro Area' },
    ],
    [],
  );
  await geography.writeState({
    status: 'complete',
    completedAt: new Date().toISOString(),
    total: 3,
  });

  await markCovered(deployment, stateScope('11'));
  return mirror;
}

let dir: string;
let mirror: Form477Mirror;

beforeEach(async () => {
  fetchMock.mockReset();
  dir = mkdtempSync(join(tmpdir(), 'fcc-mirror-test-'));
  mirror = await seedMirror(dir);
});

afterEach(async () => {
  await mirror.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('disabled passthrough', () => {
  it('serves live and never touches the mirror when no mirror is configured', async () => {
    const service = makeService(undefined);
    fetchMock.mockResolvedValueOnce(
      liveJson([{ blockcode: '110010001011000', hoconum: '130235', maxaddown: '987' }]),
    );
    const records = await service.getDeploymentByBlock('110010001011000', {}, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('opendata.fcc.gov');
    expect(records).toHaveLength(1);
    expect(records[0]?.maxDownloadMbps).toBe(987);
  });
});

describe('mirror-failure fallback', () => {
  it('degrades to the live API when the mirror layer throws', async () => {
    const throwing = {
      deploymentByBlock: () => Promise.reject(new Error('SQLITE_CORRUPT')),
    } as unknown as Form477Mirror;
    const service = makeService(throwing);
    fetchMock.mockResolvedValueOnce(
      liveJson([{ blockcode: '110010001011000', hoconum: '130235', maxaddown: '987' }]),
    );
    const records = await service.getDeploymentByBlock('110010001011000', {}, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.maxDownloadMbps).toBe(987);
  });
});

describe('deployment routing', () => {
  it('serves a covered state from the mirror without a live call', async () => {
    const service = makeService(mirror);
    const records = await service.getDeploymentByBlock('110010001011000', {}, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(records).toHaveLength(2);
    const comcast = records.find((r) => r.hoconum === '130235');
    expect(comcast).toMatchObject({
      blockFips: '110010001011000',
      providerName: 'Comcast of DC',
      holdingCompanyName: 'Comcast Corporation',
      stateAbbr: 'DC',
      techCode: '43',
      maxDownloadMbps: 987,
      maxUploadMbps: 35,
      consumer: true,
      business: false,
    });
  });

  it('applies tech, numeric speed, and consumer filters on the mirror path', async () => {
    const service = makeService(mirror);
    const fast = await service.getDeploymentByBlock('110010001011000', { minSpeedDown: 990 }, ctx);
    expect(fast).toHaveLength(1);
    expect(fast[0]?.techCode).toBe('50');

    const cable = await service.getDeploymentByBlock('110010001011000', { techCodes: ['43'] }, ctx);
    expect(cable).toHaveLength(1);
    expect(cable[0]?.hoconum).toBe('130235');

    const business = await service.getDeploymentByBlock(
      '110010001011000',
      { consumer: false },
      ctx,
    );
    expect(business).toHaveLength(1);
    expect(business[0]?.techCode).toBe('50');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the live API for an uncovered state even when rows exist locally', async () => {
    const service = makeService(mirror);
    fetchMock.mockResolvedValueOnce(liveJson([]));
    const records = await service.getDeploymentByBlock('560010001011000', {}, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(0);
  });
});

describe('area routing', () => {
  it('serves covered-state area segments from the mirror', async () => {
    const service = makeService(mirror);
    const segments = await service.getAreaSegments(
      { geographyType: 'county', geographyId: '11001', techFilter: 'acfosw', speedDown: '25' },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(segments).toHaveLength(1);
    expect(segments[0]?.population).toEqual({
      noCoverage: 10,
      oneProvider: 20,
      twoProviders: 30,
      threeOrMore: 40,
      total: 100,
    });
  });

  it('requires the full-corpus marker for geography types without an embedded state', async () => {
    const service = makeService(mirror);
    fetchMock.mockResolvedValueOnce(liveJson([]));
    await service.getAreaSegments(
      { geographyType: 'nation', techFilter: 'acfosw', speedDown: '25' },
      ctx,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    fetchMock.mockClear();
    const segments = await service.getAreaSegments(
      { geographyType: 'nation', techFilter: 'acfosw', speedDown: '25' },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(segments[0]?.population.total).toBe(1000);
  });

  it('falls back for a batch when any requested id is in an uncovered state', async () => {
    const service = makeService(mirror);
    fetchMock.mockResolvedValueOnce(liveJson([]));
    await service.getAreaStatsBatch(
      {
        geographyType: 'county',
        geographyIds: ['11001', '12001'],
        techFilter: 'acfosw',
        speedDown: '25',
      },
      ctx,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const stats = await service.getAreaStatsBatch(
      { geographyType: 'county', geographyIds: ['11001'], techFilter: 'acfosw', speedDown: '25' },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.total).toBe(100);
  });

  it('rewrites the state-prefix LIKE as a range and scopes results to the state', async () => {
    const service = makeService(mirror);
    const stats = await service.getAreaStatsByType(
      { geographyType: 'county', techFilter: 'acfosw', speedDown: '25', stateFipsPrefix: '11' },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.map((s) => s.id)).toEqual(['11001']); // 12001 excluded by the [gte, lt) range
  });

  it('requires full coverage for a type-wide scan without a state prefix', async () => {
    const service = makeService(mirror);
    fetchMock.mockResolvedValueOnce(liveJson([]));
    await service.getAreaStatsByType(
      { geographyType: 'county', techFilter: 'acfosw', speedDown: '25' },
      ctx,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('provider aggregations (full-corpus gate)', () => {
  it('serves searchProviders live under partial coverage', async () => {
    const service = makeService(mirror);
    fetchMock.mockResolvedValueOnce(liveJson([]));
    await service.searchProviders({ nameSearch: 'Comcast' }, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves searchProviders from the provider dimension under the full marker', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const providers = await service.searchProviders({ nameSearch: 'comcast' }, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toEqual({
      hoconum: '130235',
      holdingCompanyName: 'Comcast Corporation',
      statesServed: ['DC', 'MD'],
      techCodes: ['43', '50'],
    });
  });

  it('filters the dimension by state and tech', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const providers = await service.searchProviders({ state: 'DC', techCodes: ['50'] }, ctx);
    expect(providers.map((p) => p.hoconum).sort()).toEqual(['130235', '131425']);
  });

  it('serves getProviderSummary from the mirror under the full marker', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const summary = await service.getProviderSummary('130235', ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary).toEqual({
      hoconum: '130235',
      holdingCompanyName: 'Comcast Corporation',
      techCodes: ['43', '50'],
      speedTierLocations: {
        d_1: 100,
        d_2: 100,
        d_3: 90,
        d_4: 80,
        d_5: 70,
        d_6: 60,
        d_7: 50,
        d_8: 40,
      },
    });
  });

  it('returns null from the mirror for a provider absent from the corpus', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const summary = await service.getProviderSummary('000000', ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary).toBeNull();
  });

  it('serves getProviderSummary live under partial coverage', async () => {
    const service = makeService(mirror);
    fetchMock.mockImplementation(() => Promise.resolve(liveJson([])));
    await service.getProviderSummary('130235', ctx);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('geography lookups', () => {
  it('serves a covered-state geography name from the mirror', async () => {
    const service = makeService(mirror);
    const name = await service.getGeographyName('county', '11001', ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(name).toBe('District of Columbia, DC');
  });

  it('falls back live for an uncovered state and for non-embedded types', async () => {
    const service = makeService(mirror);
    fetchMock.mockImplementation(() => Promise.resolve(liveJson([])));
    await service.getGeographyName('county', '56001', ctx);
    await service.getGeographyName('cbsa', '31000', ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves a batch only when every id is covered', async () => {
    const service = makeService(mirror);
    const names = await service.getGeographyNames('county', ['11001'], ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(names.get('11001')).toBe('District of Columbia, DC');

    fetchMock.mockResolvedValueOnce(liveJson([]));
    await service.getGeographyNames('county', ['11001', '56001'], ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
