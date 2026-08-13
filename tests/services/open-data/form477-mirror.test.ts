/**
 * @fileoverview Tests for the Form 477 mirror routing and coverage gates:
 * mirror hits for covered states, silent live fallback for uncovered states,
 * full-corpus gating for cross-key aggregations, the state-prefix LIKE → range
 * rewrite, the provider-dimension query path, the per-store query ceilings, and
 * byte-identical passthrough when the mirror is absent. Stores are seeded in a
 * temp directory through the real store API with fixtures mirroring the live
 * Socrata column names.
 * @module tests/services/open-data/form477-mirror.test
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import {
  type Form477Stores,
  FULL_SCOPE,
  MAX_PROVIDER_SEARCH_ROWS,
  MAX_PROVIDER_SUMMARY_ROWS,
  MAX_SCAN_ROWS,
  markCovered,
  stateScope,
} from '@/services/open-data/mirror/stores.js';
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

  /*
   * The live table's shape: the all-technology roll-up, an overlapping
   * technology-family roll-up, and the individual technology rows both cover.
   * Summing them would report 280 at d_1 against a real national total of 100.
   */
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
      {
        sid: 'ps-2',
        hoconum: '130235',
        tech: 'cable',
        d_1: '80',
        d_2: '80',
        d_3: '70',
        d_4: '60',
        d_5: '50',
        d_6: '40',
        d_7: '30',
        d_8: '20',
      },
      {
        sid: 'ps-3',
        hoconum: '130235',
        tech: '43',
        d_1: '80',
        d_2: '80',
        d_3: '70',
        d_4: '60',
        d_5: '50',
        d_6: '40',
        d_7: '30',
        d_8: '20',
      },
      {
        sid: 'ps-4',
        hoconum: '130235',
        tech: '50',
        d_1: '20',
        d_2: '20',
        d_3: '20',
        d_4: '20',
        d_5: '20',
        d_6: '20',
        d_7: '20',
        d_8: '20',
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
    const { stats, scanTruncated } = await service.getAreaStatsByType(
      { geographyType: 'county', techFilter: 'acfosw', speedDown: '25', stateFipsPrefix: '11' },
      ctx,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stats.map((s) => s.id)).toEqual(['11001']); // 12001 excluded by the [gte, lt) range
    expect(scanTruncated).toBe(false);
  });

  it('reports the full match count when a row budget truncates a type-wide scan', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const scan = await mirror.areaStatsByType({
      geographyType: 'county',
      techFilter: 'acfosw',
      speedDown: '25',
      maxRows: 1,
    });
    // Two county rows match (11001, 12001); a one-row budget must still say so.
    expect(scan?.rows).toHaveLength(1);
    expect(scan?.total).toBe(2);
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
    const result = await service.searchProviders({ nameSearch: 'comcast' }, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]).toEqual({
      hoconum: '130235',
      holdingCompanyName: 'Comcast Corporation',
      statesServed: ['DC', 'MD'],
      techCodes: ['43', '50'],
    });
    // The FTS5 index reaches every match, so a mirror read this short is complete.
    expect(result.matched).toBe(1);
    expect(result.scanTruncated).toBe(false);
  });

  it('filters the dimension by state and tech', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const { providers } = await service.searchProviders({ state: 'DC', techCodes: ['50'] }, ctx);
    expect(providers.map((p) => p.hoconum).sort()).toEqual(['130235', '131425']);
  });

  it('reports each match’s whole footprint rather than the slice the filters selected', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const { providers } = await service.searchProviders({ state: 'DC', techCodes: ['50'] }, ctx);
    // Comcast is here for its DC fiber row, but it also files cable in MD — the
    // filters choose which companies come back, not what is true of them.
    const comcast = providers.find((p) => p.hoconum === '130235');
    expect(comcast?.statesServed).toEqual(['DC', 'MD']);
    expect(comcast?.techCodes).toEqual(['43', '50']);
  });

  it('serves provider footprints from the dimension under the full marker', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    // Every requested hoconum gets an entry — one absent from the corpus comes
    // back empty rather than missing, so no company is left unresolved.
    await expect(mirror.providerFootprints(['130235', '000000'])).resolves.toEqual(
      new Map([
        ['130235', { states: ['DC', 'MD'], techs: ['43', '50'] }],
        ['000000', { states: [], techs: [] }],
      ]),
    );
  });

  it('declines provider footprints under partial coverage', async () => {
    await expect(mirror.providerFootprints(['130235'])).resolves.toBeUndefined();
  });

  it('serves getProviderSummary from the mirror under the full marker', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    const service = makeService(mirror);
    const summary = await service.getProviderSummary('130235', ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    // Roll-up rows excluded from the codes, and the population read off the
    // all-technology row rather than summed across the four seeded rows.
    expect(summary).toEqual({
      hoconum: '130235',
      holdingCompanyName: 'Comcast Corporation',
      techCodes: ['43', '50'],
      speedTierPopulation: {
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

describe('store query ceilings', () => {
  /** Each store paired with the ceiling its spec declares. */
  const STORE_CEILINGS: ReadonlyArray<[keyof Form477Stores, number]> = [
    ['deployment', MAX_SCAN_ROWS],
    ['area', MAX_SCAN_ROWS],
    ['geography', MAX_SCAN_ROWS],
    ['providerDim', MAX_PROVIDER_SEARCH_ROWS],
    ['providerSummary', MAX_PROVIDER_SUMMARY_ROWS],
  ];

  for (const [name, ceiling] of STORE_CEILINGS) {
    it(`serves a ${name} read at the declared ceiling of ${ceiling}`, async () => {
      const { rows, total } = await mirror.stores[name].query({ limit: ceiling, offset: 0 });
      expect(rows.length).toBeGreaterThan(0);
      expect(total).toBe(rows.length);
    });

    it(`rejects a ${name} read one row above the ceiling`, async () => {
      const outcome = await mirror.stores[name]
        .query({ limit: ceiling + 1, offset: 0 })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(McpError);
      expect(outcome).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: { limit: ceiling + 1, max: ceiling },
      });
      expect((outcome as McpError).message).toBe(
        `Mirror query limit must be an integer from 1 to ${ceiling}.`,
      );
    });
  }

  it('keeps every read path on the facade inside its store ceiling', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    await expect(mirror.deploymentByBlock('110010001011000', {})).resolves.toHaveLength(2);
    await expect(
      mirror.areaSegments({
        geographyType: 'county',
        geographyId: '11001',
        techFilter: 'acfosw',
        speedDown: '25',
      }),
    ).resolves.toHaveLength(1);
    await expect(
      mirror.areaStatsBatch({
        geographyType: 'county',
        geographyIds: ['11001'],
        techFilter: 'acfosw',
        speedDown: '25',
      }),
    ).resolves.toHaveLength(1);
    // MAX_SCAN_ROWS is what getAreaStatsByType drives through here — the two
    // serving paths share one ceiling, so this is the widest read it can ask for.
    await expect(
      mirror.areaStatsByType({
        geographyType: 'county',
        techFilter: 'acfosw',
        speedDown: '25',
        stateFipsPrefix: '11',
        maxRows: MAX_SCAN_ROWS,
      }),
    ).resolves.toEqual({ rows: [expect.objectContaining({ id: '11001' })], total: 1 });
    await expect(mirror.geographyName('county', '11001')).resolves.toEqual({
      value: 'District of Columbia, DC',
    });
    await expect(mirror.geographyNames('county', ['11001'])).resolves.toEqual(
      new Map([['11001', 'District of Columbia, DC']]),
    );
    await expect(mirror.providerSummary('130235')).resolves.toMatchObject({
      holdingCompanyName: 'Comcast Corporation',
    });
    await expect(mirror.providerFootprints(['130235'])).resolves.toEqual(
      new Map([['130235', { states: ['DC', 'MD'], techs: ['43', '50'] }]]),
    );
  });

  it('rejects a type-wide scan above the store ceiling instead of clamping it', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    await expect(
      mirror.areaStatsByType({
        geographyType: 'county',
        techFilter: 'acfosw',
        speedDown: '25',
        maxRows: MAX_SCAN_ROWS + 1,
      }),
    ).rejects.toThrow(`Mirror query limit must be an integer from 1 to ${MAX_SCAN_ROWS}.`);
  });

  it('accepts the widest provider search the service can ask for and rejects one row more', async () => {
    await markCovered(mirror.stores.deployment, FULL_SCOPE);
    // open-data-service.searchProviders: Math.min(limit ?? 50, 200) * 10.
    const widest = 200 * 10;
    await expect(
      mirror.searchProviders({ nameSearch: 'comcast', rowLimit: widest }),
    ).resolves.toHaveLength(3);
    await expect(
      mirror.searchProviders({ nameSearch: 'comcast', rowLimit: widest + 1 }),
    ).rejects.toThrow(`Mirror query limit must be an integer from 1 to ${widest}.`);
  });

  it('enforces the provider-dimension ceiling on the relevance-sorted FTS path', async () => {
    const relevance = { match: '"comcast"*', sort: 'relevance' } as const;
    const { rows } = await mirror.stores.providerDim.query({
      ...relevance,
      limit: MAX_PROVIDER_SEARCH_ROWS,
      offset: 0,
    });
    expect(rows).toHaveLength(3);
    await expect(
      mirror.stores.providerDim.query({
        ...relevance,
        limit: MAX_PROVIDER_SEARCH_ROWS + 1,
        offset: 0,
      }),
    ).rejects.toThrow(
      `Mirror query limit must be an integer from 1 to ${MAX_PROVIDER_SEARCH_ROWS}.`,
    );
  });

  it('reports the full match count when the requested limit truncates the page', async () => {
    const { rows, total } = await mirror.stores.area.query({ limit: 1, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(total).toBe(3);
  });

  it('returns an empty page past the end of the match', async () => {
    const { rows, total } = await mirror.stores.area.query({ limit: 1, offset: 10 });
    expect(rows).toEqual([]);
    expect(total).toBe(3);
  });

  it('returns an empty result at the ceiling for a filter that matches nothing', async () => {
    const { rows, total } = await mirror.stores.deployment.query({
      filters: [{ column: 'blockcode', op: 'eq', value: 'no-such-block' }],
      limit: MAX_SCAN_ROWS,
      offset: 0,
    });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it('still rejects a malformed limit, and leaves offset unbounded', async () => {
    const ranged = `Mirror query limit must be an integer from 1 to ${MAX_SCAN_ROWS}.`;
    await expect(mirror.stores.area.query({ limit: 0, offset: 0 })).rejects.toThrow(ranged);
    await expect(mirror.stores.area.query({ limit: 1.5, offset: 0 })).rejects.toThrow(ranged);
    await expect(mirror.stores.area.query({ limit: 1, offset: -1 })).rejects.toThrow(
      'Mirror query offset must be an integer of at least 0.',
    );
  });

  it('leaves filter cardinality unbounded for the batched geography id lookup', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `1100${String(i).padStart(2, '0')}`);
    const { rows } = await mirror.stores.geography.query({
      filters: [
        { column: 'type', op: 'eq', value: 'county' },
        { column: 'geoid', op: 'in', value: [...ids, '11001'] },
      ],
      limit: MAX_SCAN_ROWS,
      offset: 0,
    });
    expect(rows).toHaveLength(1);
  });
});
