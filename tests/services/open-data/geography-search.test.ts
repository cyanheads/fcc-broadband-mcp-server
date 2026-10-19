/**
 * @fileoverview Geography lookup query and pagination contracts at the HTTP boundary.
 * @module tests/services/open-data/geography-search.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';

const service = () =>
  new OpenDataService({} as AppConfig, {} as StorageService, {
    mirrorEnabled: false,
    mirrorPath: 'unused',
  });

describe('geography lookup', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves a known non-national GEOID and leaves absent names unknown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ geoid: '5613150', type: 'place', name: 'Casper, WY' }]),
      )
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(service().getGeographyName('place', '5613150', createMockContext())).resolves.toBe(
      'Casper, WY',
    );
    await expect(
      service().getGeographyName('state', '99', createMockContext()),
    ).resolves.toBeUndefined();
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.searchParams.get('$where')).toBe("geoid='5613150' AND type='place'");
    expect(url.searchParams.get('$limit')).toBe('1');
  });

  it('searches the 2021 lookup with one-row lookahead', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        { type: 'cbsa', geoid: '16220', name: 'Casper, WY' },
        { type: 'place', geoid: '5613150', name: 'Casper, WY' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await service().searchGeographies(
      { name: 'Casper', limit: 1, offset: 2 },
      createMockContext(),
    );
    expect(result).toEqual({
      geographies: [{ geography_type: 'cbsa', geography_id: '16220', name: 'Casper, WY' }],
      nextOffset: 3,
    });
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.pathname).toBe('/resource/v5vt-e7vw.json');
    expect(url.searchParams.get('$where')).toBe(
      "year='2021' AND type in ('place','cbsa') AND contains(upper(name),'CASPER')",
    );
    expect(url.searchParams.get('$group')).toBe('type,geoid,name');
    expect(url.searchParams.get('$order')).toBe('name,type,geoid');
    expect(url.searchParams.get('$limit')).toBe('2');
    expect(url.searchParams.get('$offset')).toBe('2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["O'Brien", "O''BRIEN"],
    ["O'Brien%", "O''BRIEN\\%"],
    ["O'Brien_", "O''BRIEN\\_"],
    ["O'Brien\\%_", "O''BRIEN\\\\\\%\\_"],
  ])('preserves literal WHERE matching for %j', async (name, escaped) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      service().searchGeographies({ name, limit: 20, offset: 0 }, createMockContext()),
    ).resolves.toEqual({ geographies: [] });
    const where = new URL(fetchMock.mock.calls[0]![0]).searchParams.get('$where');
    expect(where).toBe(
      `year='2021' AND type in ('place','cbsa') AND contains(upper(name),'${escaped}')`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('walks disjoint pages without collapsing same-name matches or retaining stale continuation', async () => {
    const rows = [
      { type: 'place', geoid: '5613222', name: 'Casper Mountain, WY' },
      { type: 'cbsa', geoid: '16220', name: 'Casper, WY' },
      { type: 'place', geoid: '5613150', name: 'Casper, WY' },
    ];
    const fetchMock = vi.fn((url: string) => {
      const params = new URL(url).searchParams;
      const offset = Number(params.get('$offset'));
      return Promise.resolve(
        Response.json(rows.slice(offset, offset + Number(params.get('$limit')))),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();
    const first = await svc.searchGeographies(
      { name: 'Casper', limit: 2, offset: 0 },
      createMockContext(),
    );
    expect(first.nextOffset).toBe(2);
    const second = await svc.searchGeographies(
      { name: 'Casper', limit: 2, offset: first.nextOffset! },
      createMockContext(),
    );
    expect(second.geographies).toEqual([
      { geography_type: 'place', geography_id: '5613150', name: 'Casper, WY' },
    ]);
    expect(second).not.toHaveProperty('nextOffset');
    const pastEnd = await svc.searchGeographies(
      { name: 'Casper', limit: 2, offset: 4 },
      createMockContext(),
    );
    expect(pastEnd).toEqual({ geographies: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps search live with the mirror enabled and applies the optional type filter', async () => {
    const geographyName = vi.fn();
    const svc = new OpenDataService(
      {} as AppConfig,
      {} as StorageService,
      { mirrorEnabled: true, mirrorPath: 'unused' },
      { geographyName } as unknown as Form477Mirror,
    );
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      svc.searchGeographies(
        { name: 'Casper', geographyType: 'cbsa', limit: 100, offset: 0 },
        createMockContext(),
      ),
    ).resolves.toEqual({ geographies: [] });
    const params = new URL(fetchMock.mock.calls[0]![0]).searchParams;
    expect(params.get('$where')).toContain("type='cbsa'");
    expect(params.get('$limit')).toBe('101');
    expect(geographyName).not.toHaveBeenCalled();
  });

  it('fails explicitly on a sparse match instead of inventing an identifier or name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json([{ type: 'place', geoid: '5613150' }])),
    );
    await expect(
      service().searchGeographies({ name: 'Casper', limit: 20, offset: 0 }, createMockContext()),
    ).rejects.toThrow('incomplete match');
  });

  it('names the nation locally before consulting either mirror or network', async () => {
    const geographyName = vi.fn().mockRejectedValue(new Error('mirror unavailable'));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('network unavailable', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new OpenDataService(
      {} as AppConfig,
      {} as StorageService,
      { mirrorEnabled: true, mirrorPath: 'unused' },
      { geographyName } as unknown as Form477Mirror,
    );
    await expect(svc.getGeographyName('nation', '0', createMockContext())).resolves.toBe(
      'United States',
    );
    expect(geographyName).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
