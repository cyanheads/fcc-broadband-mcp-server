/**
 * @fileoverview Geo API backend faults through the real service and tool envelope.
 * @module tests/tools/geocode-backend-contract.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { geocodeBlockTool } from '@/mcp-server/tools/definitions/geocode-block.tool.js';
import { initGeoApiService } from '@/services/geo-api/geo-api-service.js';

beforeEach(() => initGeoApiService({} as AppConfig, createInMemoryStorage()));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('renders the backend failure reason and retry-later recovery on both surfaces', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: 'error',
          statusCode: '400',
          statusMessage: { severity: 'FATAL', code: '28000', routine: 'ClientAuthentication' },
        }),
        { status: 400 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const pending = runToolContract(geocodeBlockTool, { latitude: 47.6062, longitude: -122.3321 });
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: {
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: {
        reason: 'geo_backend_unavailable',
        recovery: { hint: expect.stringContaining('Retry these coordinates later') },
      },
    },
  });
  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  expect(text).toContain('geo_backend_unavailable');
  expect(text).toContain('Retry these coordinates later');
  expect(text).not.toContain('ClientAuthentication');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('preserves successful 2010 geocodes on both surfaces', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        Block: { FIPS: '530330081002024' },
        County: { FIPS: '53033', name: 'King' },
        State: { FIPS: '53', code: 'WA', name: 'Washington' },
      }),
    ),
  );
  const result = await runToolContract(geocodeBlockTool, {
    latitude: 47.6062,
    longitude: -122.3321,
  });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    blockFips: '530330081002024',
    censusVintage: '2010',
  });
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('2010 census boundaries') }),
    ]),
  );
});

it('retains no-block recovery and rejects invalid coordinates before fetch', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ Block: {} }));
  vi.stubGlobal('fetch', fetchMock);
  const noBlock = await runToolContract(geocodeBlockTool, { latitude: 0, longitude: 0 });
  expect(noBlock.structuredContent).toMatchObject({
    error: {
      code: JsonRpcErrorCode.NotFound,
      data: {
        reason: 'block_not_found',
        recovery: { hint: expect.stringContaining('nearby coordinates') },
      },
    },
  });
  expect(noBlock.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('nearby coordinates') }),
    ]),
  );
  const invalid = await runToolContract(geocodeBlockTool, { latitude: 91, longitude: -122 });
  expect(invalid.structuredContent).toMatchObject({
    error: { code: JsonRpcErrorCode.InvalidParams },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
