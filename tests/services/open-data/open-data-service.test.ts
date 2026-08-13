/**
 * @fileoverview Tests for OpenDataService — live Socrata query plumbing:
 * timeout classification at the fetch choke point, retry behavior (issue #14),
 * the ungrouped windowed provider-search query shape and its sample disclosure
 * (issue #18), the paged holding-company directory and its point-query name
 * resolution (issues #4 and #26), complete-vs-truncated raw row scans behind
 * getAreaStatsByType (issue #22), and the provider-summary query shape and
 * roll-up split behind getProviderSummary (issues #21 and #29).
 * @module tests/services/open-data/open-data-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import type { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import { MAX_SCAN_ROWS } from '@/services/open-data/mirror/stores.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';
import type {
  ProviderFootprint,
  RawAreaRow,
  RawProviderRow,
  RawProviderSummaryRow,
} from '@/services/open-data/types.js';

const serverConfig: ServerConfig = {
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

function makeService(mirror?: Form477Mirror): OpenDataService {
  return new OpenDataService({} as AppConfig, {} as StorageService, serverConfig, mirror);
}

/** One Area Table row in the shape Socrata returns — every value a string. */
function areaRow(id: string, urbanRural: 'R' | 'U'): RawAreaRow {
  return {
    id,
    type: 'county',
    tech: 'acfosw',
    speed: '100',
    urban_rural: urbanRural,
    tribal_non: 'N',
    has_0: '1',
    has_1: '2',
    has_2: '0',
    has_3more: '0',
  };
}

/** Standing nationwide county scan — the query shape issue #22 was reported against. */
const NATIONWIDE_SCAN = {
  geographyType: 'county',
  techFilter: 'acfosw',
  speedDown: '100',
  urbanRuralFilter: 'all',
} as const;

/** fetch stub that never responds — rejects with AbortError when the signal fires. */
function abortingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
  );
}

function jsonResponse(body: string): { ok: boolean; text: () => Promise<string> } {
  return { ok: true, text: () => Promise.resolve(body) };
}

/** Build one provider-summary row, tier values keyed d_1..d_8 in order. */
function summaryRow(tech: string, tiers: readonly number[]): RawProviderSummaryRow {
  const row: RawProviderSummaryRow = { hoconum: '130317', tech };
  for (const [i, value] of tiers.entries()) {
    row[`d_${i + 1}` as 'd_1'] = String(value);
  }
  return row;
}

/**
 * Comcast's live provider-summary rows (hoconum 130317, June 2021): the
 * authoritative `tech='all'` roll-up, the overlapping `cable` roll-up, and the
 * individual technology rows both of them roll up. Summing d_1 across all seven
 * gives 357,886,183 — three times the 120,819,661 the FCC's own `all` row
 * reports for the same population (issue #21).
 */
const COMCAST_SUMMARY_ROWS: RawProviderSummaryRow[] = [
  summaryRow(
    'all',
    [120819661, 120819661, 120819661, 120819661, 120686133, 118750429, 118706136, 118706136],
  ),
  summaryRow(
    'cable',
    [116116597, 116116597, 116116597, 116116597, 116062391, 114184278, 114140482, 114140482],
  ),
  summaryRow('40', [1491194, 1491194, 1491194, 1491194, 1491194, 1491194, 1490526, 1490526]),
  summaryRow('42', [1433820, 1433820, 1433820, 1433820, 1379682, 6029, 0, 0]),
  summaryRow(
    '43',
    [113193238, 113193238, 113193238, 113193238, 113193170, 112688710, 112651611, 112651611],
  ),
  summaryRow('50', [4588764, 4588764, 4588764, 4588764, 4588764, 4566175, 4565678, 4565678]),
  summaryRow('70', [242909, 242909, 242909, 242909, 45076, 0, 0, 0]),
];

/**
 * Brazoria Telephone Company's live rows (hoconum 130152) — a DSL-heavy
 * provider, so its roll-up set includes `adsl` on top of `all` and `cable`.
 * The Comcast fixture has no `adsl` row, so only this one proves a fix excludes
 * every roll-up value rather than the two Comcast happens to return.
 */
const DSL_SUMMARY_ROWS: RawProviderSummaryRow[] = [
  summaryRow('all', [24812, 24812, 24812, 24727, 22208, 12828, 12828, 12828]),
  summaryRow('adsl', [17843, 17843, 17843, 10721, 0, 0, 0, 0]),
  summaryRow('cable', [20628, 20628, 20628, 20628, 20628, 0, 0, 0]),
  summaryRow('10', [15498, 15498, 15498, 0, 0, 0, 0, 0]),
  summaryRow('12', [10721, 10721, 10721, 10721, 0, 0, 0, 0]),
  summaryRow('42', [20628, 20628, 20628, 20628, 20628, 0, 0, 0]),
  summaryRow('50', [12828, 12828, 12828, 12828, 12828, 12828, 12828, 12828]),
];

const NAME_ROW = { hoconum: '130317', holdingcompanyname: 'Comcast Corporation' };

/** `count` raw deployment rows, one distinct holding company each. */
function providerRows(count: number): RawProviderRow[] {
  return Array.from({ length: count }, (_, i) => ({
    hoconum: String(130000 + i),
    holdingcompanyname: `Provider ${i}`,
    stateabbr: 'WA',
    techcode: '50',
  }));
}

/**
 * fetch stub for the windowed provider search. `rowsFor` receives the `$limit`
 * the service actually asked for, so a test can fill the window exactly without
 * hard-coding its size.
 */
function windowFetch(rowsFor: (limit: number) => RawProviderRow[]): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const limit = Number(new URL(url).searchParams.get('$limit') ?? '0');
    return Promise.resolve(jsonResponse(JSON.stringify(rowsFor(limit))));
  });
}

/**
 * Routes a provider search's two live query shapes: the identity window, which
 * carries no `$group`, and the per-hoconum footprint group. `footprints` is
 * keyed by hoconum, and a hoconum missing from it answers with no rows — the
 * shape a company absent from the deployment table produces.
 */
function providerSearchFetch(options: {
  windowRows: RawProviderRow[];
  footprints: Record<string, RawProviderRow[]>;
}): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const params = new URL(url).searchParams;
    if (params.get('$group') === null) {
      return Promise.resolve(jsonResponse(JSON.stringify(options.windowRows)));
    }
    const hoconum = /hoconum='([^']*)'/.exec(params.get('$where') ?? '')?.[1] ?? '';
    return Promise.resolve(jsonResponse(JSON.stringify(options.footprints[hoconum] ?? [])));
  });
}

/** Deployment rows in the shape a footprint group returns — state × technology pairs. */
function footprintRows(states: string[], techs: string[]): RawProviderRow[] {
  return states.flatMap((stateabbr) => techs.map((techcode) => ({ stateabbr, techcode })));
}

/** The mirror's footprint map, matching {@link providerRows}' one-state, one-technology shape. */
function mirrorFootprints(hoconums: string[]): Map<string, ProviderFootprint> {
  return new Map(hoconums.map((hoconum) => [hoconum, { states: ['WA'], techs: ['50'] }]));
}

/**
 * Comcast's live June 2021 footprint (hoconum 130317), measured 2026-08-13:
 * 49 states and five technology codes. A 1,000-row search window over the
 * block-level deployment table exposes a strict subset of both.
 */
const COMCAST_STATES = [
  'AL',
  'AR',
  'AZ',
  'CA',
  'CO',
  'CT',
  'DC',
  'DE',
  'FL',
  'GA',
  'HI',
  'IA',
  'ID',
  'IL',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MI',
  'MN',
  'MO',
  'MS',
  'MT',
  'NC',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'NY',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VA',
  'VT',
  'WA',
  'WI',
  'WV',
];
const COMCAST_TECHS = ['40', '42', '43', '50', '70'];

/** Routes listProviders' two concurrent queries: the count carries `$select=count(1)`. */
function directoryFetch(options: { hoconums: string[]; total: number }): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const select = new URL(url).searchParams.get('$select') ?? '';
    const body = select.startsWith('count(')
      ? [{ total: String(options.total) }]
      : options.hoconums.map((hoconum) => ({ hoconum }));
    return Promise.resolve(jsonResponse(JSON.stringify(body)));
  });
}

/** Answers a single-hoconum name point query from a hoconum → name fixture. */
function nameFetch(byHoconum: Record<string, string>): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const hoconum = /hoconum='(\d+)'/.exec(new URL(url).searchParams.get('$where') ?? '')?.[1];
    const name = hoconum ? byHoconum[hoconum] : undefined;
    return Promise.resolve(
      jsonResponse(JSON.stringify(name ? [{ hoconum, holdingcompanyname: name }] : [])),
    );
  });
}

/**
 * Routes getProviderSummary's two concurrent fetches by dataset id, since
 * Promise.all gives no call ordering to key a sequential mock off.
 */
function providerFetch(options: {
  nameRows?: unknown[];
  summaryRows?: readonly RawProviderSummaryRow[];
}): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    const rows = url.includes('yd9y-6jqe') ? (options.summaryRows ?? []) : (options.nameRows ?? []);
    return Promise.resolve(jsonResponse(JSON.stringify(rows)));
  });
}

describe('OpenDataService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('searchProviders live query shape', () => {
    it('reads an unordered window of raw rows — no GROUP BY and no ORDER BY', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);

      await makeService().searchProviders(
        { nameSearch: 'communications', limit: 50 },
        createMockContext(),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
      // Grouping is what could not complete inside the deadline (issue #18).
      expect(url.searchParams.get('$group')).toBeNull();
      // Ordering sorts every matching row before the window is taken, which
      // collapses the page onto whichever holding company sorts first.
      expect(url.searchParams.get('$order')).toBeNull();
      // Identity only — the window says which companies matched, nothing about them.
      expect(url.searchParams.get('$select')).toBe('hoconum,holdingcompanyname');
      // A fixed row window, not a multiple of the caller's provider limit.
      expect(Number(url.searchParams.get('$limit'))).toBeGreaterThan(50);
    });

    it('reads the same window whether or not a name search is given', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);
      const service = makeService();

      await service.searchProviders({ nameSearch: 'tele', limit: 50 }, createMockContext());
      await service.searchProviders({ state: 'WA', limit: 5 }, createMockContext());

      const limits = fetchMock.mock.calls.map((call) =>
        new URL(call[0] as string).searchParams.get('$limit'),
      );
      expect(limits[0]).toBe(limits[1]);
    });

    it('builds the $where from name, state, and technology filters', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);

      await makeService().searchProviders(
        { nameSearch: "O'Hara", state: 'WA', techCodes: ['50', '60'] },
        createMockContext(),
      );

      const where = new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('$where');
      // Apostrophes are doubled so the fragment cannot terminate the literal.
      expect(where).toBe(
        "upper(holdingcompanyname) LIKE upper('%O''Hara%') AND stateabbr='WA' AND techcode IN ('50','60')",
      );
    });

    it('omits $where entirely for an unfiltered search', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().searchProviders({}, createMockContext());

      expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('$where')).toBeNull();
      expect(result.providers).toEqual([]);
      expect(result.matched).toBe(0);
      expect(result.scanTruncated).toBe(false);
    });

    it('folds a provider’s many window rows into one record, keeping the first name seen', async () => {
      vi.stubGlobal(
        'fetch',
        providerSearchFetch({
          windowRows: [
            { hoconum: '130317', holdingcompanyname: 'Comcast Corporation' },
            // The same hoconum under a second filed name — one record, first name wins.
            { hoconum: '130317', holdingcompanyname: 'Midcontinent Communications' },
            // A row with no hoconum carries no provider and is skipped.
            { holdingcompanyname: 'Orphan row' },
          ],
          footprints: { '130317': footprintRows(['CA', 'WA'], ['43', '50']) },
        }),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'comcast' },
        createMockContext(),
      );

      expect(result.matched).toBe(1);
      expect(result.providers).toEqual([
        {
          hoconum: '130317',
          holdingCompanyName: 'Comcast Corporation',
          statesServed: ['CA', 'WA'],
          techCodes: ['43', '50'],
        },
      ]);
    });

    it('reports a provider’s whole footprint, never the subset its window rows carried', async () => {
      /*
       * The window rows carry three of Comcast's five technology codes and two
       * of its 49 states — the shape a 1,000-row window over the block-level
       * deployment table actually produces. Aggregating them is what understated
       * the company; the record must come from the footprint group instead.
       */
      const windowRows: RawProviderRow[] = [
        { hoconum: '130317', holdingcompanyname: 'Comcast Corporation' },
        { hoconum: '130317', holdingcompanyname: 'Comcast Corporation' },
      ];
      vi.stubGlobal(
        'fetch',
        providerSearchFetch({
          windowRows,
          footprints: { '130317': footprintRows(COMCAST_STATES, COMCAST_TECHS) },
        }),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'Comcast' },
        createMockContext(),
      );

      const provider = result.providers[0];
      expect(provider?.techCodes).toEqual(COMCAST_TECHS);
      expect(provider?.statesServed).toEqual(COMCAST_STATES);
      // The window's own view of the same company, which must not be the answer.
      expect(provider?.techCodes).not.toEqual(['42', '43', '50']);
      expect(provider?.statesServed).not.toEqual(['CA', 'WA']);
    });

    it('reports an empty footprint rather than falling back to the window rows', async () => {
      /*
       * Pins that the window values are never a fallback: with the footprint
       * lookup answering with no rows, the record reports nothing rather than
       * the states and technologies the window happened to expose.
       */
      vi.stubGlobal(
        'fetch',
        providerSearchFetch({
          windowRows: [
            {
              hoconum: '130317',
              holdingcompanyname: 'Comcast Corporation',
              stateabbr: 'WA',
              techcode: '43',
            },
          ],
          footprints: {},
        }),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'Comcast' },
        createMockContext(),
      );

      expect(result.providers).toEqual([
        {
          hoconum: '130317',
          holdingCompanyName: 'Comcast Corporation',
          statesServed: [],
          techCodes: [],
        },
      ]);
    });

    it('resolves each footprint with an indexed point group, never an IN batch', async () => {
      const fetchMock = providerSearchFetch({
        windowRows: providerRows(3),
        footprints: {},
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeService().searchProviders({ nameSearch: 'tele' }, createMockContext());

      const groups = fetchMock.mock.calls
        .map((call) => new URL(call[0] as string).searchParams)
        .filter((params) => params.get('$group') !== null);
      expect(groups).toHaveLength(3);
      for (const params of groups) {
        expect(params.get('$group')).toBe('stateabbr,techcode');
        expect(params.get('$select')).toBe('stateabbr,techcode');
        // An `IN (…)` list over the same column is what does not complete.
        expect(params.get('$where')).toMatch(/^hoconum='\d+'$/);
      }
      expect(groups.map((params) => params.get('$where'))).toEqual([
        "hoconum='130002'",
        "hoconum='130001'",
        "hoconum='130000'",
      ]);
    });

    it('resolves footprints only for the providers the limit returns', async () => {
      const fetchMock = providerSearchFetch({ windowRows: providerRows(40), footprints: {} });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().searchProviders(
        { nameSearch: 'tele', limit: 5 },
        createMockContext(),
      );

      expect(result.matched).toBe(40);
      // One window read plus one footprint lookup per returned provider.
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it('skips a hoconum that is not digits rather than interpolating it into SoQL', async () => {
      const fetchMock = providerSearchFetch({
        windowRows: [{ hoconum: "13' OR '1'='1", holdingcompanyname: 'Malformed upstream row' }],
        footprints: {},
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().searchProviders({}, createMockContext());

      // The match is still reported; only its footprint lookup is withheld.
      expect(result.providers).toEqual([
        {
          hoconum: "13' OR '1'='1",
          holdingCompanyName: 'Malformed upstream row',
          statesServed: [],
          techCodes: [],
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('classifies a footprint deadline as the non-retryable live search timeout', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (new URL(url).searchParams.get('$group') === null) {
          return Promise.resolve(
            jsonResponse(JSON.stringify([{ hoconum: '130317', holdingcompanyname: 'Comcast' }])),
          );
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService()
        .searchProviders({ nameSearch: 'Comcast' }, createMockContext())
        .then(
          () => {
            throw new Error('expected the footprint lookup to reject');
          },
          (error: unknown) => error,
        );
      await vi.advanceTimersByTimeAsync(31_000);
      const error = await pending;

      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(JsonRpcErrorCode.Timeout);
      expect((error as McpError).data).toMatchObject({
        reason: 'live_search_timeout',
        retryable: false,
      });
      // A single attempt — the retry amplification issue #14 removed.
      const groupCalls = fetchMock.mock.calls.filter(
        ([url]) => new URL(String(url)).searchParams.get('$group') !== null,
      );
      expect(groupCalls).toHaveLength(1);
    });

    it('reports scanTruncated when the window fills', async () => {
      vi.stubGlobal(
        'fetch',
        windowFetch((limit) => providerRows(limit)),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'tele', limit: 10 },
        createMockContext(),
      );

      expect(result.scanTruncated).toBe(true);
      expect(result.scanRowCap).toBeGreaterThan(0);
      // The window bounds the scan, never the caller's page.
      expect(result.providers).toHaveLength(10);
      expect(result.matched).toBe(result.scanRowCap);
    });

    it('reports a short read as a complete scan', async () => {
      vi.stubGlobal(
        'fetch',
        windowFetch(() => providerRows(3)),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'tele', limit: 10 },
        createMockContext(),
      );

      expect(result.scanTruncated).toBe(false);
      expect(result.matched).toBe(3);
      expect(result.providers).toHaveLength(3);
    });

    it('counts every distinct match before trimming the returned list to the limit', async () => {
      vi.stubGlobal(
        'fetch',
        windowFetch(() => providerRows(40)),
      );

      const result = await makeService().searchProviders(
        { nameSearch: 'tele', limit: 5 },
        createMockContext(),
      );

      expect(result.matched).toBe(40);
      expect(result.providers).toHaveLength(5);
      expect(result.scanTruncated).toBe(false);
    });

    it('bounds the mirror path by its own row limit and reports that cap', async () => {
      const mirror = {
        searchProviders: (options: { rowLimit: number }) =>
          Promise.resolve(providerRows(options.rowLimit)),
        providerFootprints: (hoconums: string[]) => Promise.resolve(mirrorFootprints(hoconums)),
      } as unknown as Form477Mirror;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService(mirror).searchProviders(
        { nameSearch: 'tele', limit: 20 },
        createMockContext(),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      // 10 provider-dimension rows per requested provider, the mirror store's ceiling.
      expect(result.scanRowCap).toBe(200);
      expect(result.scanTruncated).toBe(true);
      expect(result.providers).toHaveLength(20);
    });

    it('reports a complete mirror read as untruncated', async () => {
      const mirror = {
        searchProviders: () => Promise.resolve(providerRows(2)),
        providerFootprints: (hoconums: string[]) => Promise.resolve(mirrorFootprints(hoconums)),
      } as unknown as Form477Mirror;
      vi.stubGlobal('fetch', vi.fn());

      const result = await makeService(mirror).searchProviders(
        { nameSearch: 'tele', limit: 20 },
        createMockContext(),
      );

      expect(result.scanTruncated).toBe(false);
      expect(result.matched).toBe(2);
    });

    it('takes footprints from the mirror without touching the live API', async () => {
      const mirror = {
        searchProviders: () => Promise.resolve(providerRows(1)),
        providerFootprints: () =>
          Promise.resolve(new Map([['130000', { states: COMCAST_STATES, techs: COMCAST_TECHS }]])),
      } as unknown as Form477Mirror;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService(mirror).searchProviders(
        { nameSearch: 'tele', limit: 20 },
        createMockContext(),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.providers[0]?.statesServed).toEqual(COMCAST_STATES);
      expect(result.providers[0]?.techCodes).toEqual(COMCAST_TECHS);
    });

    it('resolves footprints live when the mirror serves the search but declines them', async () => {
      const mirror = {
        searchProviders: () => Promise.resolve(providerRows(1)),
        // The coverage gate declines — undefined means serve this read live.
        providerFootprints: () => Promise.resolve(undefined),
      } as unknown as Form477Mirror;
      const fetchMock = providerSearchFetch({
        windowRows: [],
        footprints: { '130000': footprintRows(['OR', 'WA'], ['50']) },
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService(mirror).searchProviders(
        { nameSearch: 'tele', limit: 20 },
        createMockContext(),
      );

      // Only the footprint group went live; the search itself still came from the mirror.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('$group')).toBe(
        'stateabbr,techcode',
      );
      expect(result.providers[0]?.statesServed).toEqual(['OR', 'WA']);
      expect(result.providers[0]?.techCodes).toEqual(['50']);
    });
  });

  describe('listProviders directory page', () => {
    it('pages the provider summary table by offset and reads the total alongside it', async () => {
      const fetchMock = directoryFetch({ total: 2223, hoconums: ['130196', '130199'] });
      vi.stubGlobal('fetch', fetchMock);

      const page = await makeService().listProviders(
        { limit: 25, offset: 100 },
        createMockContext(),
      );

      const urls = fetchMock.mock.calls.map((call) => new URL(call[0] as string));
      expect(urls).toHaveLength(2);
      for (const url of urls) {
        // Issue #4's fix: the directory never groups the deployment table.
        expect(url.pathname).toContain('yd9y-6jqe');
        expect(url.searchParams.get('$group')).toBeNull();
        expect(url.searchParams.get('$where')).toBe("tech='all'");
      }

      const pageUrl = urls.find((u) => u.searchParams.get('$offset') !== null);
      expect(pageUrl?.searchParams.get('$order')).toBe('hoconum ASC');
      expect(pageUrl?.searchParams.get('$limit')).toBe('25');
      expect(pageUrl?.searchParams.get('$offset')).toBe('100');

      expect(page.providers).toEqual([{ hoconum: '130196' }, { hoconum: '130199' }]);
      expect(page.total).toBe(2223);
    });

    it('returns an empty page past the end of the directory without losing the total', async () => {
      vi.stubGlobal('fetch', directoryFetch({ total: 2223, hoconums: [] }));

      const page = await makeService().listProviders(
        { limit: 25, offset: 5000 },
        createMockContext(),
      );

      expect(page.providers).toEqual([]);
      expect(page.total).toBe(2223);
    });

    it('reports a total of zero for an empty directory', async () => {
      vi.stubGlobal('fetch', directoryFetch({ total: 0, hoconums: [] }));

      const page = await makeService().listProviders({ limit: 25, offset: 0 }, createMockContext());

      expect(page.providers).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('getProviderNames', () => {
    it('resolves each hoconum with an indexed point query — no GROUP BY', async () => {
      const fetchMock = nameFetch({ '130317': 'Comcast Corporation', '130152': 'Brazoria' });
      vi.stubGlobal('fetch', fetchMock);

      const names = await makeService().getProviderNames(['130317', '130152'], createMockContext());

      expect(names.get('130317')).toBe('Comcast Corporation');
      expect(names.get('130152')).toBe('Brazoria');
      for (const call of fetchMock.mock.calls) {
        const url = new URL(call[0] as string);
        expect(url.pathname).toContain('jdr4-3q4p');
        expect(url.searchParams.get('$group')).toBeNull();
        expect(url.searchParams.get('$limit')).toBe('1');
        expect(url.searchParams.get('$where')).toMatch(/^hoconum='\d+'$/);
      }
    });

    it('leaves a hoconum with no deployment row out of the map', async () => {
      vi.stubGlobal('fetch', nameFetch({ '130317': 'Comcast Corporation' }));

      const names = await makeService().getProviderNames(['130317', '999999'], createMockContext());

      expect(names.has('999999')).toBe(false);
      expect(names.size).toBe(1);
    });

    it('keeps the rest of the page when one lookup fails', async () => {
      const fetchMock = vi.fn((url: string) => {
        const where = new URL(url).searchParams.get('$where') ?? '';
        if (where.includes('130152')) {
          return Promise.resolve(new Response('bad request', { status: 400 }));
        }
        return Promise.resolve(
          jsonResponse('[{"hoconum":"130317","holdingcompanyname":"Comcast"}]'),
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const names = await makeService().getProviderNames(['130317', '130152'], createMockContext());

      expect(names.get('130317')).toBe('Comcast');
      expect(names.has('130152')).toBe(false);
    });

    it('issues no request for an empty list', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(makeService().getProviderNames([], createMockContext())).resolves.toEqual(
        new Map(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips a non-numeric hoconum rather than interpolating it into SoQL', async () => {
      const fetchMock = nameFetch({ '130317': 'Comcast Corporation' });
      vi.stubGlobal('fetch', fetchMock);

      const names = await makeService().getProviderNames(
        ['130317', "1'; DROP--"],
        createMockContext(),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(names.size).toBe(1);
    });
  });

  describe('getAreaStatsByType raw scan', () => {
    it('aggregates every page of a 6,262-row scan with two segments per county', async () => {
      // 3,131 counties × an R and a U segment — the live nationwide county
      // count, and well past the 5,000-row cap the tool used to impose.
      const rows = Array.from({ length: 3131 }, (_, i) => {
        const id = String(i + 1).padStart(5, '0');
        return [areaRow(id, 'R'), areaRow(id, 'U')];
      }).flat();

      const fetchMock = vi.fn((url: string) => {
        const params = new URL(url).searchParams;
        const offset = Number(params.get('$offset') ?? '0');
        const limit = Number(params.get('$limit') ?? '1000');
        return Promise.resolve(jsonResponse(JSON.stringify(rows.slice(offset, offset + limit))));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().getAreaStatsByType(NATIONWIDE_SCAN, createMockContext());

      expect(result.stats).toHaveLength(3131);
      expect(result.scanTruncated).toBe(false);
      // Both segments folded into one county row: 2 × has_0, 2 × has_1.
      expect(result.stats[0]).toMatchObject({
        id: '00001',
        noCoverage: 2,
        oneProvider: 4,
        total: 6,
      });
      expect(fetchMock).toHaveBeenCalledTimes(7); // 6 full pages + a 262-row tail
    });

    it('reports scanTruncated when the live pager stops at the row ceiling', async () => {
      // Every page comes back full, so the pager never sees the end of the match.
      const fullPage = JSON.stringify(
        Array.from({ length: 1000 }, (_, i) => areaRow(String(i).padStart(5, '0'), 'R')),
      );
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fullPage));
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().getAreaStatsByType(NATIONWIDE_SCAN, createMockContext());

      expect(result.scanTruncated).toBe(true);
      expect(result.scanRowCap).toBe(MAX_SCAN_ROWS);
      expect(fetchMock).toHaveBeenCalledTimes(MAX_SCAN_ROWS / 1000);
    });

    it('reports scanTruncated on the mirror path when rows fall short of the match', async () => {
      const partialMirror = {
        areaStatsByType: () =>
          Promise.resolve({ rows: [areaRow('11001', 'R')], total: MAX_SCAN_ROWS + 1 }),
      } as unknown as Form477Mirror;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService(partialMirror).getAreaStatsByType(
        NATIONWIDE_SCAN,
        createMockContext(),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.scanTruncated).toBe(true);
      expect(result.stats).toHaveLength(1);
    });

    it('reports a complete mirror scan as untruncated', async () => {
      const wholeMirror = {
        areaStatsByType: () => Promise.resolve({ rows: [areaRow('11001', 'R')], total: 1 }),
      } as unknown as Form477Mirror;
      vi.stubGlobal('fetch', vi.fn());

      const result = await makeService(wholeMirror).getAreaStatsByType(
        NATIONWIDE_SCAN,
        createMockContext(),
      );

      expect(result.scanTruncated).toBe(false);
      expect(result.scanRowCap).toBe(MAX_SCAN_ROWS);
    });
  });

  describe('getProviderSummary live query shape', () => {
    it('reads the holding-company name with a plain point query — no deployment GROUP BY', async () => {
      const fetchMock = providerFetch({ nameRows: [NAME_ROW], summaryRows: COMCAST_SUMMARY_ROWS });
      vi.stubGlobal('fetch', fetchMock);

      await makeService().getProviderSummary('130317', createMockContext());

      const urls = fetchMock.mock.calls.map((call) => new URL(call[0] as string));
      // Two point queries, not three: the deployment technology GROUP BY is gone.
      expect(urls).toHaveLength(2);
      for (const url of urls) {
        expect(url.searchParams.get('$group')).toBeNull();
      }

      const nameUrl = urls.find((u) => u.pathname.includes('jdr4-3q4p'));
      expect(nameUrl?.searchParams.get('$select')).toBe('hoconum,holdingcompanyname');
      expect(nameUrl?.searchParams.get('$where')).toBe("hoconum='130317'");
      expect(nameUrl?.searchParams.get('$limit')).toBe('1');

      const summaryUrl = urls.find((u) => u.pathname.includes('yd9y-6jqe'));
      expect(summaryUrl?.searchParams.get('$where')).toBe("hoconum='130317'");
    });

    it('sources technology codes from the provider-summary rows, not the deployment table', async () => {
      const fetchMock = providerFetch({ nameRows: [NAME_ROW], summaryRows: COMCAST_SUMMARY_ROWS });
      vi.stubGlobal('fetch', fetchMock);

      const summary = await makeService().getProviderSummary('130317', createMockContext());

      expect(summary?.techCodes).toEqual(['40', '42', '43', '50', '70']);
      expect(
        fetchMock.mock.calls.filter((c) => (c[0] as string).includes('techcode')),
      ).toHaveLength(0);
    });

    it('reports the tech=all roll-up population instead of summing overlapping rows', async () => {
      vi.stubGlobal(
        'fetch',
        providerFetch({ nameRows: [NAME_ROW], summaryRows: COMCAST_SUMMARY_ROWS }),
      );

      const summary = await makeService().getProviderSummary('130317', createMockContext());

      // The FCC's own national total for Comcast at the first four tiers.
      expect(summary?.speedTierPopulation.d_1).toBe(120819661);
      expect(summary?.speedTierPopulation.d_4).toBe(120819661);
      expect(summary?.speedTierPopulation.d_5).toBe(120686133);
      expect(summary?.speedTierPopulation.d_8).toBe(118706136);
      // Summing every row is the double-count this replaces.
      expect(summary?.speedTierPopulation.d_1).not.toBe(357886183);
    });

    it('excludes the adsl roll-up a DSL-heavy provider reports, not just all and cable', async () => {
      vi.stubGlobal(
        'fetch',
        providerFetch({
          nameRows: [{ hoconum: '130152', holdingcompanyname: 'Brazoria Telephone Company' }],
          summaryRows: DSL_SUMMARY_ROWS,
        }),
      );

      const summary = await makeService().getProviderSummary('130152', createMockContext());

      expect(summary?.techCodes).toEqual(['10', '12', '42', '50']);
      expect(summary?.speedTierPopulation.d_1).toBe(24812);
      expect(summary?.speedTierPopulation.d_4).toBe(24727);
    });

    it('returns null when the deployment table has no row for the hoconum', async () => {
      vi.stubGlobal('fetch', providerFetch({ nameRows: [], summaryRows: [] }));

      await expect(makeService().getProviderSummary('999999', createMockContext())).resolves.toBe(
        null,
      );
    });

    it('reports no coverage for a provider absent from the provider-summary table', async () => {
      // Business-only carriers appear in the deployment table but report no
      // population coverage, so the summary table has no rows for them.
      vi.stubGlobal(
        'fetch',
        providerFetch({
          nameRows: [{ hoconum: '130982', holdingcompanyname: 'Zayo Group, LLC' }],
          summaryRows: [],
        }),
      );

      const summary = await makeService().getProviderSummary('130982', createMockContext());

      expect(summary?.holdingCompanyName).toBe('Zayo Group, LLC');
      expect(summary?.techCodes).toEqual([]);
      expect(summary?.speedTierPopulation).toEqual({});
    });

    it('applies the same roll-up split to mirror-served rows', async () => {
      const mirror = {
        providerSummary: () =>
          Promise.resolve({
            holdingCompanyName: 'Comcast Corporation',
            summaryRows: COMCAST_SUMMARY_ROWS,
          }),
      } as unknown as Form477Mirror;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const summary = await makeService(mirror).getProviderSummary('130317', createMockContext());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(summary?.techCodes).toEqual(['40', '42', '43', '50', '70']);
      expect(summary?.speedTierPopulation.d_1).toBe(120819661);
    });
  });

  describe('timeout classification', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('fails the live provider search once on deadline — no retry amplification', async () => {
      const fetchMock = abortingFetch();
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService()
        .searchProviders({ nameSearch: 'communications' }, createMockContext())
        .then(
          () => {
            throw new Error('expected searchProviders to reject');
          },
          (error: unknown) => error,
        );

      // First deadline fires at 30s; run far past it to prove no further attempts.
      await vi.advanceTimersByTimeAsync(180_000);
      const error = await pending;

      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(JsonRpcErrorCode.Timeout);
      expect(mcpError.data?.retryable).toBe(false);
      expect(mcpError.data?.reason).toBe('live_search_timeout');
      const recovery = mcpError.data?.recovery as { hint: string } | undefined;
      expect(recovery?.hint).toContain('FCC_MIRROR_ENABLED');
      // Narrowing the input does not decide whether this query completes, so the
      // hint no longer tells the caller to add a state filter (issue #18).
      expect(recovery?.hint).not.toContain('state filter');
      // The whole point of issue #14: exactly one upstream attempt.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails the provider summary once on deadline — one attempt per query', async () => {
      const fetchMock = abortingFetch();
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService()
        .getProviderSummary('130317', createMockContext())
        .then(
          () => {
            throw new Error('expected getProviderSummary to reject');
          },
          (error: unknown) => error,
        );

      await vi.advanceTimersByTimeAsync(180_000);
      const error = await pending;

      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(JsonRpcErrorCode.Timeout);
      expect(mcpError.data?.retryable).toBe(false);
      expect(mcpError.data?.reason).toBe('live_provider_timeout');
      const recovery = mcpError.data?.recovery as { hint: string } | undefined;
      expect(recovery?.hint).toContain('FCC_MIRROR_ENABLED');
      // Two concurrent queries, one attempt each — not four attempts apiece.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('still retries a transient deadline on a cheap point query', async () => {
      let calls = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          });
        }
        return Promise.resolve(jsonResponse('[{"geoid":"53","type":"state","name":"Washington"}]'));
      });
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService().getGeographyName('state', '53', createMockContext());

      // 30s deadline aborts attempt 1, then backoff (~1.5s base ± jitter) precedes attempt 2.
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toBe('Washington');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
