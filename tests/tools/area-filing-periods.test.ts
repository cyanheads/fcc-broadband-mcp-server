/**
 * @fileoverview Integration tests for historical Form 477 Area Table routing.
 * @module tests/tools/area-filing-periods.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareAreasTool } from '@/mcp-server/tools/definitions/compare-areas.tool.js';
import { findUnderservedTool } from '@/mcp-server/tools/definitions/find-underserved.tool.js';
import { getCoverageSummaryTool } from '@/mcp-server/tools/definitions/get-coverage-summary.tool.js';
import { initOpenDataService } from '@/services/open-data/open-data-service.js';

describe('historical Area Table tools', () => {
  beforeEach(() => {
    initOpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps an explicit June 2021 selection byte-identical to the default national read', async () => {
    const fetchMock = vi.fn((_url: string) => Response.json([{ has_0: '15', has_1: '30' }]));
    vi.stubGlobal('fetch', fetchMock);
    const args = { geography_type: 'nation' } as const;
    const defaultResult = await runToolContract(getCoverageSummaryTool, args);
    const explicitResult = await runToolContract(getCoverageSummaryTool, {
      ...args,
      as_of_date: '2021-06-30',
    });
    expect(defaultResult.structuredContent).toMatchObject({
      dataVintage: 'June 2021 (last Form 477 filing period)',
      population: { total: 45 },
    });
    expect(defaultResult.structuredContent).not.toHaveProperty('vintageNotice');
    expect(defaultResult.structuredContent).toEqual(explicitResult.structuredContent);
    expect(defaultResult.content).toEqual(explicitResult.content);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      const request = new URL(url);
      expect(request.pathname).toBe('/resource/xvwq-qtaj.json');
      expect(request.searchParams.get('$where')).toBe(
        "type='nation' AND id='0' AND tech='acfow' AND speed='25'",
      );
    }
  });

  it.each(['2015-06-30', '2015-12-31', '2016-06-30', '2022-06-30', '2021-6-30'])(
    'rejects unsupported date %s in all three tools before a network read',
    async (as_of_date) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      // Exercise raw wire input before the narrower per-tool schema accepts it.
      const call = runToolContract<Parameters<typeof runToolContract>[0]>;
      const results = await Promise.all([
        call(getCoverageSummaryTool, { geography_type: 'nation', as_of_date }),
        call(compareAreasTool, {
          geography_type: 'state',
          geography_ids: ['28', '11'],
          as_of_date,
        }),
        call(findUnderservedTool, { as_of_date }),
      ]);
      for (const result of results) {
        expect(result.structuredContent).toMatchObject({
          error: {
            code: -32602,
            data: {
              reason: 'invalid_arguments',
              recovery: { hint: expect.stringContaining('as_of_date') },
            },
          },
        });
        expect(JSON.stringify(result.content)).toContain('invalid_arguments');
        expect(JSON.stringify(result.content)).toContain('as_of_date');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('selects the older dataset for the filtered read and unfiltered confirmation, and looks up names for the same year', async () => {
    const queries: URL[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      const request = new URL(url);
      queries.push(request);
      const where = request.searchParams.get('$where') ?? '';
      if (request.pathname.endsWith('/v5vt-e7vw.json')) {
        return Response.json([{ name: 'Austin-Round Rock, TX' }]);
      }
      return Response.json(
        where.includes("tribal_non='T'")
          ? []
          : [{ id: '12420', urban_rural: 'U', tribal_non: 'N', has_0: '15', has_1: '30' }],
      );
    });
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'cbsa',
      geography_id: '12420',
      tribal_filter: 'T',
      as_of_date: '2016-12-31',
    });
    expect(result.structuredContent).toMatchObject({
      dataVintage: '2016-12-31',
      geography: { name: 'Austin-Round Rock, TX' },
      population: { total: 0 },
      notice: expect.stringContaining('No population rows'),
      vintageNotice: expect.stringContaining('December 2020'),
    });
    expect(JSON.stringify(result.content)).toContain('2016-12-31');
    expect(JSON.stringify(result.content)).toContain('December 2020');
    expect(JSON.stringify(result.content)).toContain('Austin-Round Rock, TX');
    expect(queries.filter((url) => url.pathname.endsWith('/xv2f-wqqz.json'))).toHaveLength(2);
    expect(queries.filter((url) => url.pathname.endsWith('/v5vt-e7vw.json'))).toEqual([
      expect.objectContaining({ search: expect.stringContaining('2016') }),
    ]);
  });

  it('selects the comparison snapshot and its batch name year', async () => {
    const queries: URL[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      const request = new URL(url);
      queries.push(request);
      return Response.json(
        request.pathname.endsWith('/v5vt-e7vw.json')
          ? [{ geoid: '12420', name: 'Austin-Round Rock, TX' }]
          : [{ id: '12420', has_0: '15', has_1: '30' }],
      );
    });
    const result = await runToolContract(compareAreasTool, {
      geography_type: 'cbsa',
      geography_ids: ['12420', '10540'],
      as_of_date: '2017-12-31',
    });
    expect(result.structuredContent).toMatchObject({
      dataVintage: '2017-12-31',
      vintageNotice: expect.stringContaining('December 2020'),
      unmatchedIds: ['10540'],
      areas: [{ id: '12420', name: 'Austin-Round Rock, TX', noCoverage: 15 }],
    });
    expect(JSON.stringify(result.content)).toContain('2017-12-31');
    expect(JSON.stringify(result.content)).toContain('December 2020');
    expect(queries[0]?.pathname).toBe('/resource/fnid-qg8r.json');
    expect(queries[1]?.searchParams.get('$where')).toContain("year='2017'");
  });

  it('retains the historical vintage and comparison notice past an exhausted ranking page', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Response.json([{ id: '28115', has_0: '14008', has_1: '4182' }]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await runToolContract(findUnderservedTool, {
      state: 'MS',
      as_of_date: '2020-06-30',
      offset: 1,
    });
    expect(result.structuredContent).toMatchObject({
      areas: [],
      offset: 1,
      dataVintage: '2020-06-30',
      vintageNotice: expect.stringContaining('December 2020'),
    });
    expect(JSON.stringify(result.content)).toContain('2020-06-30');
    expect(JSON.stringify(result.content)).toContain('December 2020');
    expect(JSON.stringify(result.content)).toContain('This page is exhausted.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/resource/wxit-5xtm.json');
  });

  it('ranks the selected snapshot before paging and requests only the returned names', async () => {
    const fetchMock = vi.fn((url: string) => {
      const request = new URL(url);
      if (request.pathname === '/resource/v5vt-e7vw.json') {
        return Response.json([
          { geoid: '28115', name: 'Pontotoc County, MS' },
          { geoid: '28115', name: 'Pontotoc County, MS' },
        ]);
      }
      return Response.json([
        { id: '28115', has_0: '14008', has_1: '4182' },
        { id: '28049', has_0: '15000', has_1: '5000' },
        { id: '28045', has_0: '5000', has_1: '9000' },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runToolContract(findUnderservedTool, {
      state: 'MS',
      as_of_date: '2020-06-30',
      offset: 1,
      limit: 1,
    });
    expect(result.structuredContent).toMatchObject({
      areas: [{ id: '28115', rank: 2, name: 'Pontotoc County, MS', noCoverage: 14_008 }],
      offset: 1,
      nextOffset: 2,
      dataVintage: '2020-06-30',
      vintageNotice: expect.stringContaining('December 2020'),
    });
    expect(JSON.stringify(result.content)).toContain('Pontotoc County, MS (28115)');
    expect(JSON.stringify(result.content)).toContain('14,008');
    expect(JSON.stringify(result.content)).toContain('December 2020');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [areaRequest, nameRequest] = fetchMock.mock.calls.map(([url]) => new URL(url));
    expect(areaRequest?.pathname).toBe('/resource/wxit-5xtm.json');
    expect(nameRequest?.pathname).toBe('/resource/v5vt-e7vw.json');
    expect(nameRequest?.searchParams.get('$where')).toBe(
      "year='2020' AND type='county' AND geoid IN ('28115')",
    );
  });

  it('returns December 2020 without the pre-December comparison notice', async () => {
    const fetchMock = vi.fn((_url: string) => Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    const result = await runToolContract(findUnderservedTool, {
      state: 'MS',
      as_of_date: '2020-12-31',
    });
    expect(result.structuredContent).toMatchObject({ areas: [], dataVintage: '2020-12-31' });
    expect(result.structuredContent).not.toHaveProperty('vintageNotice');
    expect(JSON.stringify(result.content)).not.toContain('discontinuity');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/resource/ymd4-xaiz.json');
  });
});
