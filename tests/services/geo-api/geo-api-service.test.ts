/**
 * @fileoverview Tests for GeoApiService — the FCC Area API request shape and
 * block normalization. Pins the census vintage the request asks for (issue
 * #20): the Area API defaults to 2020 blocks, while the Form 477 deployment
 * dataset every availability query reads is keyed by 2010 blocks, so an
 * unpinned request returns a block ID that resolves to nothing downstream.
 * @module tests/services/geo-api/geo-api-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoApiService } from '@/services/geo-api/geo-api-service.js';
import type { GeoApiBlockResponse } from '@/services/geo-api/types.js';

/** Seattle (47.6062, -122.3321) as the Area API answers it for censusYear=2010. */
const SEATTLE_2010: GeoApiBlockResponse = {
  Block: { FIPS: '530330081002024' },
  County: { FIPS: '53033', name: 'King' },
  State: { FIPS: '53', code: 'WA', name: 'Washington' },
  status: 'OK',
};

function jsonResponse(body: GeoApiBlockResponse): { ok: boolean; json: () => Promise<unknown> } {
  return { ok: true, json: () => Promise.resolve(body) };
}

function makeService(): GeoApiService {
  return new GeoApiService({} as AppConfig, {} as StorageService);
}

/** Stubs global fetch with a single canned response and returns the spy. */
function stubFetch(body: GeoApiBlockResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GeoApiService.findBlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('pins censusYear=2010 so the block matches the Form 477 deployment dataset', async () => {
    const fetchMock = stubFetch(SEATTLE_2010);
    const ctx = createMockContext();

    await makeService().findBlock(47.6062, -122.3321, ctx);

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('censusYear')).toBe('2010');
    expect(url.searchParams.get('latitude')).toBe('47.6062');
    expect(url.searchParams.get('longitude')).toBe('-122.3321');
    expect(url.searchParams.get('format')).toBe('json');
  });

  it('returns the 2010 block alongside county and state identifiers', async () => {
    stubFetch(SEATTLE_2010);
    const ctx = createMockContext();

    const result = await makeService().findBlock(47.6062, -122.3321, ctx);

    expect(result).toEqual({
      blockFips: '530330081002024',
      censusVintage: '2010',
      countyFips: '53033',
      countyName: 'King',
      stateFips: '53',
      stateCode: 'WA',
      stateName: 'Washington',
    });
  });

  it('returns null when the API reports an error', async () => {
    stubFetch({ isError: true, messages: ['no block'], status: 'ERROR' });
    const ctx = createMockContext();

    await expect(makeService().findBlock(0, 0, ctx)).resolves.toBeNull();
  });

  it('returns null when no block covers the coordinates', async () => {
    stubFetch({ Block: {}, status: 'OK' });
    const ctx = createMockContext();

    await expect(makeService().findBlock(0, 0, ctx)).resolves.toBeNull();
  });

  it('normalizes a sparse upstream payload without inventing county or state facts', async () => {
    stubFetch({ Block: { FIPS: '530330081002024' }, status: 'OK' });
    const ctx = createMockContext();

    const result = await makeService().findBlock(47.6062, -122.3321, ctx);

    expect(result).toEqual({
      blockFips: '530330081002024',
      censusVintage: '2010',
      countyFips: '',
      countyName: '',
      stateFips: '',
      stateCode: '',
      stateName: '',
    });
  });

  it('throws when the API returns a block FIPS that is not 15 digits', async () => {
    stubFetch({ Block: { FIPS: '5303300810' }, status: 'OK' });
    const ctx = createMockContext();

    const error = await makeService()
      .findBlock(47.6062, -122.3321, ctx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect((error as McpError).message).toContain('15 digits');
  });
});
