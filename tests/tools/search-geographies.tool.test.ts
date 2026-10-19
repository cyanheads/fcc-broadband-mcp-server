/**
 * @fileoverview Geography discovery contracts through real service and production output parsing.
 * @module tests/tools/search-geographies.tool.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoverageSummaryTool } from '@/mcp-server/tools/definitions/get-coverage-summary.tool.js';
import { searchGeographiesTool } from '@/mcp-server/tools/definitions/search-geographies.tool.js';
import { initOpenDataService } from '@/services/open-data/open-data-service.js';

const rows = [
  { type: 'place', geoid: '5613222', name: 'Casper Mountain, WY' },
  { type: 'cbsa', geoid: '16220', name: 'Casper, WY' },
  { type: 'place', geoid: '5613150', name: 'Casper, WY' },
];

describe('fcc_search_geographies', () => {
  beforeEach(() => {
    initOpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns named matches and continuation on both surfaces, with no BDC credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rows)));
    const result = await runToolContract(searchGeographiesTool, { name: 'Casper', limit: 2 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      geographies: [
        { geography_type: 'place', geography_id: '5613222', name: 'Casper Mountain, WY' },
        { geography_type: 'cbsa', geography_id: '16220', name: 'Casper, WY' },
      ],
      count: 2,
      offset: 0,
      nextOffset: 2,
      dataVintage: '2021',
      notice: expect.stringContaining('more matches remain'),
    });
    const rendered = JSON.stringify(result.content);
    for (const term of [
      '5613222',
      '16220',
      'Casper, WY',
      'place',
      'cbsa',
      '2021',
      'Next Offset',
      'more matches remain',
    ])
      expect(rendered).toContain(term);
  });

  it.each([0, 100])(
    'discloses empty offset %s on both surfaces without claiming a total',
    async (offset) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])));
      const result = await runToolContract(searchGeographiesTool, { name: 'No match', offset });
      expect(result.structuredContent).toMatchObject({
        geographies: [],
        count: 0,
        offset,
        notice: expect.stringContaining(offset ? 'past the end' : 'No geographies matched'),
      });
      expect(result.structuredContent).not.toHaveProperty('nextOffset');
      expect(result.structuredContent).not.toHaveProperty('totalCount');
      expect(JSON.stringify(result.content)).toContain(
        offset ? 'past the end' : 'No geographies matched',
      );
    },
  );

  it('does not announce truncation when exactly limit matches are the final page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rows.slice(0, 2))));
    const result = await runToolContract(searchGeographiesTool, { name: 'Casper', limit: 2 });
    expect(result.structuredContent).not.toHaveProperty('nextOffset');
    expect(result.structuredContent).not.toHaveProperty('notice');
  });

  it('uses defaults and treats a blank optional type as omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await runToolContract(searchGeographiesTool, { name: ' Casper ', geography_type: '' });
    const params = new URL(fetchMock.mock.calls[0]![0]).searchParams;
    expect(params.get('$limit')).toBe('21');
    expect(params.get('$offset')).toBe('0');
    expect(params.get('$where')).toContain("contains(upper(name),'CASPER')");
    expect(params.get('$where')).toContain("type in ('place','cbsa')");
  });

  it.each([
    {},
    { name: '' },
    { name: '  ' },
    { name: true },
    { name: 'a', limit: 101 },
    { name: 'a', limit: 0 },
    { name: 'a', offset: -1 },
    { name: 'a', offset: 0.5 },
    { name: 'a', geography_type: 'state' },
  ])('rejects invalid input %j before network access', async (input) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await runToolContract(searchGeographiesTool, input as never);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: { reason: 'invalid_arguments', recovery: { hint: expect.any(String) } },
      },
    });
    expect(JSON.stringify(result.content)).toContain('invalid_arguments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes upstream rejection without the token-bearing request URL', async () => {
    initOpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
      opendataAppToken: 'private-test-token',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not allowed', { status: 403 })));
    const result = await runToolContract(searchGeographiesTool, { name: 'Casper' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: JsonRpcErrorCode.Forbidden } });
    expect(JSON.stringify(result.content)).toContain('FCC Open Data');
    expect(JSON.stringify(result)).not.toContain('private-test-token');
  });

  it('chains the distinct Casper place and CBSA to coverage without changing GEOIDs', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (new URL(url).pathname.includes('v5vt-e7vw'))
        return Promise.resolve(Response.json(rows.slice(1)));
      return Promise.resolve(
        Response.json([
          {
            has_0: '0',
            has_1: '1',
            has_2: '4223',
            has_3more: '14635',
            urban_rural: 'R',
            tribal_non: 'N',
          },
          {
            has_0: '0',
            has_1: '0',
            has_2: '0',
            has_3more: '61956',
            urban_rural: 'U',
            tribal_non: 'N',
          },
        ]),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const search = await runToolContract(searchGeographiesTool, { name: 'Casper, WY' });
    const matches = searchGeographiesTool.output.parse(search.structuredContent).geographies;
    expect(matches).toEqual([
      { geography_type: 'cbsa', geography_id: '16220', name: 'Casper, WY' },
      { geography_type: 'place', geography_id: '5613150', name: 'Casper, WY' },
    ]);
    for (const geo of matches) {
      const result = await runToolContract(getCoverageSummaryTool, {
        geography_type: geo.geography_type,
        geography_id: geo.geography_id,
      });
      expect(result.structuredContent).toMatchObject({
        geography: { type: geo.geography_type, id: geo.geography_id },
        population: { total: 80815 },
      });
      expect(JSON.stringify(result.content)).toContain(geo.geography_id);
    }
    const areaWheres = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter((url) => url.pathname.includes('xvwq-qtaj'))
      .map((url) => url.searchParams.get('$where'));
    expect(areaWheres).toEqual(
      expect.arrayContaining([
        expect.stringContaining("id='16220'"),
        expect.stringContaining("id='5613150'"),
      ]),
    );
  });
});
