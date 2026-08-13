/**
 * @fileoverview Tests for the fcc-broadband://providers/list/{offset} resource.
 * @module tests/resources/providers-list.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providersListResource } from '@/mcp-server/resources/definitions/providers-list.resource.js';

const mockListProviders = vi.fn();
const mockGetProviderNames = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({
    listProviders: mockListProviders,
    getProviderNames: mockGetProviderNames,
  }),
}));

const PAGE = [{ hoconum: '130152' }, { hoconum: '130317' }, { hoconum: '200001' }];
const NAMES = new Map([
  ['130152', 'Brazoria Telephone Company'],
  ['130317', 'Comcast Corporation'],
  ['200001', 'Zayo Group, LLC'],
]);

/** Parse an offset the way the URI template delivers it — always a string. */
function params(offset: string) {
  return providersListResource.params!.parse({ offset });
}

describe('providersListResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProviders.mockResolvedValue({ providers: PAGE, total: 2223 });
    mockGetProviderNames.mockResolvedValue(NAMES);
  });

  describe('paging', () => {
    it('returns the first page with names, the directory total, and a next offset', async () => {
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('0'), ctx);

      expect(result.providers).toEqual([
        { hoconum: '130152', holdingCompanyName: 'Brazoria Telephone Company' },
        { hoconum: '130317', holdingCompanyName: 'Comcast Corporation' },
        { hoconum: '200001', holdingCompanyName: 'Zayo Group, LLC' },
      ]);
      expect(result.offset).toBe(0);
      expect(result.count).toBe(3);
      expect(result.total).toBe(2223);
      expect(result.nextOffset).toBe(3);
      expect(result.notice).toContain('1–3 of 2223');
      expect(result.notice).toContain('fcc-broadband://providers/list/3');
    });

    it('asks the service for a bounded page at the requested offset', async () => {
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('100'), ctx);

      expect(mockListProviders).toHaveBeenCalledWith({ limit: result.pageSize, offset: 100 }, ctx);
      expect(result.pageSize).toBeGreaterThan(0);
      expect(result.offset).toBe(100);
      expect(result.nextOffset).toBe(103);
      expect(result.notice).toContain('101–103 of 2223');
    });

    it('resolves names only for the hoconums on the page', async () => {
      const ctx = createMockContext();
      await providersListResource.handler(params('0'), ctx);

      expect(mockGetProviderNames).toHaveBeenCalledWith(['130152', '130317', '200001'], ctx);
    });

    it('omits nextOffset on the last page', async () => {
      mockListProviders.mockResolvedValue({ providers: PAGE, total: 3 });
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('0'), ctx);

      expect(result.nextOffset).toBeUndefined();
      expect(result.notice).toContain('this is the last page');
    });

    it('omits nextOffset on a page that exactly exhausts the directory', async () => {
      mockListProviders.mockResolvedValue({ providers: PAGE, total: 103 });
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('100'), ctx);

      expect(result.nextOffset).toBeUndefined();
      expect(result.notice).toContain('101–103 of 103');
    });
  });

  describe('boundaries', () => {
    it('distinguishes an exhausted page from an empty directory', async () => {
      mockListProviders.mockResolvedValue({ providers: [], total: 2223 });
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('5000'), ctx);

      expect(result.providers).toEqual([]);
      expect(result.count).toBe(0);
      // The non-zero total is what separates "past the end" from "nothing there".
      expect(result.total).toBe(2223);
      expect(result.nextOffset).toBeUndefined();
      expect(result.notice).toContain('past the end');
      expect(result.notice).toContain('fcc-broadband://providers/list/0');
    });

    it('reports an empty directory as empty rather than exhausted', async () => {
      mockListProviders.mockResolvedValue({ providers: [], total: 0 });
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('0'), ctx);

      expect(result.count).toBe(0);
      expect(result.total).toBe(0);
      expect(result.notice).toContain('directory is empty');
      expect(result.notice).not.toContain('past the end');
    });

    it('rejects a non-numeric offset at the schema', () => {
      expect(() => params('abc')).toThrow();
      expect(() => params('-1')).toThrow();
      expect(() => params('')).toThrow();
    });
  });

  describe('name resolution', () => {
    it('omits holdingCompanyName for a hoconum the lookup could not resolve', async () => {
      mockGetProviderNames.mockResolvedValue(new Map([['130317', 'Comcast Corporation']]));
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('0'), ctx);

      expect(result.providers[0]).toEqual({ hoconum: '130152' });
      expect(result.providers[1]).toEqual({
        hoconum: '130317',
        holdingCompanyName: 'Comcast Corporation',
      });
      expect(result.notice).toContain('2 of the 3 entries have no holdingCompanyName');
    });

    it('says nothing about unresolved names when every name resolved', async () => {
      const ctx = createMockContext();
      const result = await providersListResource.handler(params('0'), ctx);

      expect(result.notice).not.toContain('holdingCompanyName');
    });
  });

  it('points at the name-resolution tool on every page', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler(params('0'), ctx);
    expect(result.notice).toContain('fcc_search_providers');
  });

  it('includes dataVintage in output', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler(params('0'), ctx);
    expect(result.dataVintage).toContain('2021');
  });

  it('advertises the first page in the resource listing', async () => {
    // The listing callback ignores its SDK `extra`; nothing in it is read here.
    const listing = await providersListResource.list!(
      {} as Parameters<NonNullable<typeof providersListResource.list>>[0],
    );
    expect(listing.resources).toHaveLength(1);
    expect(listing.resources[0]).toMatchObject({ uri: 'fcc-broadband://providers/list/0' });
  });

  it('propagates service errors', async () => {
    mockListProviders.mockRejectedValue(new Error('upstream unavailable'));
    const ctx = createMockContext();
    await expect(providersListResource.handler(params('0'), ctx)).rejects.toThrow(
      'upstream unavailable',
    );
  });

  it('does not expose environment variable names in output', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler(params('0'), ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/API_KEY/i);
    expect(serialized).not.toMatch(/FCC_BDC/i);
    expect(serialized).not.toMatch(/PASSWORD/i);
  });

  it('returns hoconum values as strings', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler(params('0'), ctx);
    for (const p of result.providers) {
      expect(typeof p.hoconum).toBe('string');
    }
  });
});
