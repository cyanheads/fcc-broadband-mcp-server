/**
 * @fileoverview Tests for the fcc_geocode_block tool, including the geocode →
 * availability chain the 2010 census vintage exists to keep working (issue #20).
 * @module tests/tools/geocode-block.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geocodeBlockTool } from '@/mcp-server/tools/definitions/geocode-block.tool.js';
import { searchAvailabilityTool } from '@/mcp-server/tools/definitions/search-availability.tool.js';

const mockFindBlock = vi.fn();
const mockGetDeploymentByBlock = vi.fn();

vi.mock('@/services/geo-api/geo-api-service.js', () => ({
  getGeoApiService: () => ({ findBlock: mockFindBlock }),
}));

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ getDeploymentByBlock: mockGetDeploymentByBlock }),
}));

/** Seattle (47.6062, -122.3321) on 2010 boundaries — the block Form 477 carries. */
const SEATTLE_BLOCK: ReturnType<typeof geocodeBlockTool.output.parse> = {
  blockFips: '530330081002024',
  censusVintage: '2010',
  countyFips: '53033',
  countyName: 'King',
  stateFips: '53',
  stateCode: 'WA',
  stateName: 'Washington',
};

describe('geocodeBlockTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindBlock.mockResolvedValue(SEATTLE_BLOCK);
  });

  it('returns block location for valid coordinates', async () => {
    const ctx = createMockContext({ errors: geocodeBlockTool.errors });
    const input = geocodeBlockTool.input.parse({ latitude: 47.6062, longitude: -122.3321 });
    const result = await geocodeBlockTool.handler(input, ctx);
    expect(result).toMatchObject({
      blockFips: '530330081002024',
      censusVintage: '2010',
      countyFips: '53033',
      countyName: 'King',
      stateCode: 'WA',
    });
    expect(mockFindBlock).toHaveBeenCalledWith(47.6062, -122.3321, ctx);
  });

  it('reports the 2010 census vintage the Form 477 dataset is keyed by', async () => {
    const ctx = createMockContext({ errors: geocodeBlockTool.errors });
    const input = geocodeBlockTool.input.parse({ latitude: 47.6062, longitude: -122.3321 });
    const result = await geocodeBlockTool.handler(input, ctx);
    expect(result.censusVintage).toBe('2010');
  });

  it('throws block_not_found when service returns null (no block at coordinates)', async () => {
    mockFindBlock.mockResolvedValue(null);
    const ctx = createMockContext({ errors: geocodeBlockTool.errors });
    const input = geocodeBlockTool.input.parse({ latitude: 0, longitude: 0 });
    await expect(geocodeBlockTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'block_not_found' },
    });
  });

  it('formats output with blockFips, census vintage, county, and state', () => {
    const blocks = geocodeBlockTool.format!(SEATTLE_BLOCK);
    expect(blocks.length).toBeGreaterThan(0);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('530330081002024');
    expect(text).toContain('2010');
    expect(text).toContain('King');
    expect(text).toContain('Washington');
    expect(text).toContain('WA');
    expect(text).toContain('53033');
    expect(text).toContain('53');
  });

  /*
   * The reported failure was cross-tool: a geocoded block that looks valid but
   * matches no deployment row. The deployment stub answers only for the 2010
   * block, so a geocode that hands back any other vintage fails the chain here
   * exactly as it fails in production — with block_not_found.
   */
  describe('geocode → availability chain', () => {
    const SEATTLE_OFFERING = {
      blockFips: '530330081002024',
      providerId: '0001234',
      providerName: 'Comcast Cable',
      holdingCompanyName: 'Comcast',
      hoconum: '130317',
      stateAbbr: 'WA',
      techCode: '43',
      maxDownloadMbps: 1200,
      maxUploadMbps: 35,
      consumer: true,
      business: false,
    };

    beforeEach(() => {
      mockGetDeploymentByBlock.mockImplementation((blockFips: string) =>
        Promise.resolve(blockFips === '530330081002024' ? [SEATTLE_OFFERING] : []),
      );
    });

    it('feeds a geocoded block straight into fcc_search_availability', async () => {
      const geoCtx = createMockContext({ errors: geocodeBlockTool.errors });
      const located = await geocodeBlockTool.handler(
        geocodeBlockTool.input.parse({ latitude: 47.6062, longitude: -122.3321 }),
        geoCtx,
      );

      const availabilityCtx = createMockContext({ errors: searchAvailabilityTool.errors });
      const availability = await searchAvailabilityTool.handler(
        searchAvailabilityTool.input.parse({ block_fips: located.blockFips }),
        availabilityCtx,
      );

      expect(availability.blockFips).toBe(located.blockFips);
      expect(availability.providers).toHaveLength(1);
      expect(availability.totalProviders).toBe(1);
      expect(mockGetDeploymentByBlock).toHaveBeenCalledWith(
        '530330081002024',
        expect.any(Object),
        availabilityCtx,
      );
    });

    it('throws block_not_found when a non-Form-477 block vintage is geocoded', async () => {
      // The 2020-vintage block for the same coordinates — the pre-fix output.
      mockFindBlock.mockResolvedValue({ ...SEATTLE_BLOCK, blockFips: '530330081021016' });
      const geoCtx = createMockContext({ errors: geocodeBlockTool.errors });
      const located = await geocodeBlockTool.handler(
        geocodeBlockTool.input.parse({ latitude: 47.6062, longitude: -122.3321 }),
        geoCtx,
      );

      const availabilityCtx = createMockContext({ errors: searchAvailabilityTool.errors });
      await expect(
        searchAvailabilityTool.handler(
          searchAvailabilityTool.input.parse({ block_fips: located.blockFips }),
          availabilityCtx,
        ),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: { reason: 'block_not_found' },
      });
    });
  });
});
