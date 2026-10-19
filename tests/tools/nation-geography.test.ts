/**
 * @fileoverview National naming through real service, tool, and resource boundaries.
 * @module tests/tools/nation-geography.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geographySummaryResource } from '@/mcp-server/resources/definitions/geography-summary.resource.js';
import { getCoverageSummaryTool } from '@/mcp-server/tools/definitions/get-coverage-summary.tool.js';
import { initOpenDataService } from '@/services/open-data/open-data-service.js';

const areaRows = [
  {
    type: 'nation',
    id: '0',
    urban_rural: 'R',
    tribal_non: 'N',
    has_0: '10',
    has_1: '20',
    has_2: '30',
    has_3more: '40',
  },
  {
    type: 'nation',
    id: '0',
    urban_rural: 'U',
    tribal_non: 'N',
    has_0: '0',
    has_1: '10',
    has_2: '40',
    has_3more: '50',
  },
];

describe('national geography name', () => {
  beforeEach(() =>
    initOpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
    }),
  );
  afterEach(() => vi.unstubAllGlobals());

  function fetchWithUnavailableLookup() {
    const mock = vi.fn((url: string) =>
      Promise.resolve(
        new URL(url).pathname.includes('v5vt-e7vw')
          ? new Response('lookup unavailable', { status: 403 })
          : Response.json(areaRows),
      ),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('renders United States first while retaining nation 0 and aggregation on both tool surfaces', async () => {
    const fetchMock = fetchWithUnavailableLookup();
    const result = await runToolContract(getCoverageSummaryTool, { geography_type: 'nation' });
    expect(result.structuredContent).toMatchObject({
      geography: { type: 'nation', id: '0', name: 'United States' },
      population: {
        total: 200,
        noCoverage: 10,
        oneProvider: 30,
        twoProviders: 70,
        threeOrMore: 90,
      },
      coveragePct: 95,
      unservedPct: 5,
      competitivePct: 80,
    });
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    expect(text.split('\n')[0]).toBe('## United States — Broadband Coverage Summary');
    expect(text).toContain('nation=0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('$where')).toContain("id='0'");
  });

  it('returns the national name and key from the geography resource without a name request', async () => {
    const fetchMock = fetchWithUnavailableLookup();
    const result = await geographySummaryResource.handler(
      { type: 'nation', id: '0' },
      createMockContext(),
    );
    expect(geographySummaryResource.output!.parse(result)).toMatchObject({
      geography: { type: 'nation', id: '0', name: 'United States' },
      population: { total: 200 },
      coveragePct: 95,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves non-national fail-soft names when the lookup is unavailable', async () => {
    fetchWithUnavailableLookup();
    const tool = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'state',
      geography_id: '53',
    });
    expect(tool.isError).toBeFalsy();
    expect(getCoverageSummaryTool.output.parse(tool.structuredContent).geography).toEqual({
      type: 'state',
      id: '53',
    });
    const resource = await geographySummaryResource.handler(
      { type: 'state', id: '53' },
      createMockContext(),
    );
    expect(resource.geography).toEqual({ type: 'state', id: '53' });
  });
});
