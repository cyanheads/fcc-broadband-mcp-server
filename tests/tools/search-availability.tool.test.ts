/**
 * @fileoverview Tests for the fcc_search_availability tool.
 * @module tests/tools/search-availability.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchAvailabilityTool } from '@/mcp-server/tools/definitions/search-availability.tool.js';

const mockGetDeploymentByBlock = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ getDeploymentByBlock: mockGetDeploymentByBlock }),
}));

const MOCK_PROVIDER = {
  blockFips: '530330081021016',
  providerId: '0001234',
  providerName: 'Comcast Cable',
  holdingCompanyName: 'Comcast',
  hoconum: '130152',
  stateAbbr: 'WA',
  techCode: '41',
  maxDownloadMbps: 1200,
  maxUploadMbps: 35,
  consumer: true,
  business: false,
};

describe('searchAvailabilityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeploymentByBlock.mockResolvedValue([MOCK_PROVIDER]);
  });

  it('returns providers for a valid block FIPS', async () => {
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({ block_fips: '530330081021016' });
    const result = await searchAvailabilityTool.handler(input, ctx);
    expect(result.blockFips).toBe('530330081021016');
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.hoconum).toBe('130152');
    expect(result.providers[0]!.techLabel).toBe('Cable modem (DOCSIS 1, 1.1, 2.0)');
    expect(result.totalProviders).toBe(1);
    // enrichment
    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters).toBeDefined();
    expect(enrichment.notice).toBeUndefined();
  });

  it('passes tech filter and min speed to service', async () => {
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({
      block_fips: '530330081021016',
      tech_filter: ['50'],
      min_speed_down: 100,
      consumer: true,
    });
    await searchAvailabilityTool.handler(input, ctx);
    expect(mockGetDeploymentByBlock).toHaveBeenCalledWith(
      '530330081021016',
      expect.objectContaining({ techCodes: ['50'], minSpeedDown: 100, consumer: true }),
      ctx,
    );
  });

  it('omits optional params when not provided', async () => {
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({ block_fips: '530330081021016' });
    await searchAvailabilityTool.handler(input, ctx);
    const callArgs = mockGetDeploymentByBlock.mock.calls[0]![1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('techCodes');
    expect(callArgs).not.toHaveProperty('minSpeedDown');
    expect(callArgs).not.toHaveProperty('consumer');
  });

  it('deduplicates distinct holding companies for totalProviders', async () => {
    const sameHolco = {
      ...MOCK_PROVIDER,
      techCode: '50',
      techLabel: 'Fiber to premises',
    };
    mockGetDeploymentByBlock.mockResolvedValue([MOCK_PROVIDER, sameHolco]);
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({ block_fips: '530330081021016' });
    const result = await searchAvailabilityTool.handler(input, ctx);
    expect(result.providers).toHaveLength(2);
    expect(result.totalProviders).toBe(1); // same hoconum/holding company
  });

  it('sets notice in enrichment when no providers match filters', async () => {
    mockGetDeploymentByBlock.mockResolvedValue([]);
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({
      block_fips: '530330081021016',
      tech_filter: ['50'],
    });
    const result = await searchAvailabilityTool.handler(input, ctx);
    expect(result.providers).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('530330081021016');
  });

  it('throws block_not_found when service returns empty with no filters', async () => {
    mockGetDeploymentByBlock.mockResolvedValue([]);
    const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
    const input = searchAvailabilityTool.input.parse({ block_fips: '530330081021016' });
    await expect(searchAvailabilityTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'block_not_found' },
    });
  });

  it('formats output with hoconum, provider name, speed, and techLabel', () => {
    const output = {
      blockFips: '530330081021016',
      providers: [
        {
          ...MOCK_PROVIDER,
          techLabel: 'Cable modem (DOCSIS 1, 1.1, 2.0)',
        },
      ],
      totalProviders: 1,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = searchAvailabilityTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('530330081021016');
    expect(text).toContain('130152');
    expect(text).toContain('Comcast');
    expect(text).toContain('1200');
    expect(text).toContain('Cable modem');
    expect(text).toContain('1');
  });

  /*
   * The FCC's own techcode definition on the deployment dataset (jdr4-3q4p):
   * 10=Asymetrical xDSL | 11=ADSL2 | 12=VDSL | 20=Symetrical xDSL | 30=Other
   * Copper Wireline | 40=Cable Modem | 41=Cable Modem-DOCSIS1,1.1, and 2.0 |
   * 42=Cable Modem-DOCSIS 3.0 | 43=Cable Modem-DOCSIS 3.1 | 50=Optical
   * Carrier/Fiber to the End User | 60=Satellite | 70=Terrestrial Fixed
   * Wireless | 90=Electric Power Line | 0=All Other.
   */
  describe('Form 477 technology taxonomy', () => {
    it.each([
      ['0', 'All other'],
      ['10', 'DSL (ADSL)'],
      ['11', 'DSL (ADSL2)'],
      ['12', 'DSL (VDSL)'],
      ['20', 'DSL (symmetric xDSL)'],
      ['30', 'Other copper wireline'],
      ['40', 'Cable modem'],
      ['41', 'Cable modem (DOCSIS 1, 1.1, 2.0)'],
      ['42', 'Cable modem (DOCSIS 3.0)'],
      ['43', 'Cable modem (DOCSIS 3.1)'],
      ['50', 'Fiber to premises'],
      ['60', 'Satellite'],
      ['70', 'Fixed wireless'],
      ['90', 'Electric power line'],
    ])('labels technology code %s as "%s"', async (techCode, expected) => {
      mockGetDeploymentByBlock.mockResolvedValue([{ ...MOCK_PROVIDER, techCode }]);
      const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
      const input = searchAvailabilityTool.input.parse({ block_fips: '530330081002024' });
      const result = await searchAvailabilityTool.handler(input, ctx);
      expect(result.providers[0]!.techLabel).toBe(expected);
    });

    it.each(['0', '10', '11', '12', '20', '30', '40', '41', '42', '43', '50', '60', '70', '90'])(
      'accepts technology code %s in tech_filter',
      (techCode) => {
        expect(
          searchAvailabilityTool.input.parse({
            block_fips: '530330081002024',
            tech_filter: [techCode],
          }).tech_filter,
        ).toEqual([techCode]);
      },
    );

    it('rejects a technology code outside the FCC taxonomy', () => {
      expect(() =>
        searchAvailabilityTool.input.parse({
          block_fips: '530330081002024',
          tech_filter: ['99'],
        }),
      ).toThrow();
    });

    it('passes a previously-rejected code through to the service filter', async () => {
      mockGetDeploymentByBlock.mockResolvedValue([{ ...MOCK_PROVIDER, techCode: '30' }]);
      const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
      const input = searchAvailabilityTool.input.parse({
        block_fips: '530330081002024',
        tech_filter: ['30'],
      });
      const result = await searchAvailabilityTool.handler(input, ctx);
      expect(mockGetDeploymentByBlock).toHaveBeenCalledWith(
        '530330081002024',
        expect.objectContaining({ techCodes: ['30'] }),
        ctx,
      );
      expect(result.providers[0]!.techLabel).toBe('Other copper wireline');
    });

    it('falls back to a generic label for a code the dataset has not documented', async () => {
      mockGetDeploymentByBlock.mockResolvedValue([{ ...MOCK_PROVIDER, techCode: '99' }]);
      const ctx = createMockContext({ errors: searchAvailabilityTool.errors });
      const input = searchAvailabilityTool.input.parse({ block_fips: '530330081002024' });
      const result = await searchAvailabilityTool.handler(input, ctx);
      expect(result.providers[0]!.techLabel).toBe('Technology 99');
    });
  });

  it('formats empty provider list gracefully', () => {
    const output = {
      blockFips: '530330081021016',
      providers: [],
      totalProviders: 0,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = searchAvailabilityTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('530330081021016');
    expect(text).toContain('0');
  });
});
