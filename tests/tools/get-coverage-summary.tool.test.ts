/**
 * @fileoverview Tests for the fcc_get_coverage_summary tool.
 * @module tests/tools/get-coverage-summary.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoverageSummaryTool } from '@/mcp-server/tools/definitions/get-coverage-summary.tool.js';

const mockGetAreaSegments = vi.fn();
const mockGetGeographyName = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({
    getAreaSegments: mockGetAreaSegments,
    getGeographyName: mockGetGeographyName,
  }),
}));

const MOCK_SEGMENT = {
  urbanRural: 'R' as const,
  tribal: 'N' as const,
  population: {
    noCoverage: 50000,
    oneProvider: 30000,
    twoProviders: 15000,
    threeOrMore: 5000,
    total: 100000,
  },
  coveragePct: 50,
  unservedPct: 50,
  competitivePct: 20,
};

describe('getCoverageSummaryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT]);
    mockGetGeographyName.mockResolvedValue('Mississippi');
  });

  it('returns coverage summary for a state', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'state',
      geography_id: '28',
    });
    const result = await getCoverageSummaryTool.handler(input, ctx);
    expect(result.geography.type).toBe('state');
    expect(result.geography.id).toBe('28');
    expect(result.geography.name).toBe('Mississippi');
    expect(result.population.total).toBe(100000);
    expect(result.unservedPct).toBe(50);
    // enrichment
    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters).toBeDefined();
    expect(enrichment.appliedFilters.geographyType).toBe('state');
    expect(enrichment.appliedFilters.geographyId).toBe('28');
    expect(enrichment.appliedFilters.speedDownMbps).toBe(25);
  });

  it('returns nation-level summary without geography_id', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({ geography_type: 'nation' });
    const result = await getCoverageSummaryTool.handler(input, ctx);
    expect(result.geography.type).toBe('nation');
    expect(result.geography.id).toBe('0');
  });

  it('throws invalid_geography_combo when geography_id omitted for non-nation type', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({ geography_type: 'state' });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_combo' },
    });
  });

  it('throws invalid_geography_combo when geography_id provided for nation', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'nation',
      geography_id: '0',
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_combo' },
    });
  });

  it('rejects a county FIPS passed as state with the cross-hint, before any service call', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'state',
      geography_id: '06037',
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_id_shape' },
      message: expect.stringContaining('county FIPS'),
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      message: expect.stringContaining('"06"'),
    });
    expect(mockGetAreaSegments).not.toHaveBeenCalled();
  });

  it.each([
    ['state', '0601'],
    ['county', '06'],
    ['cd', '06037'],
    ['cbsa', '310'],
    ['place', '06440'],
  ])('throws invalid_geography_id_shape for geography_type="%s" with mis-shaped id "%s"', async (geographyType, geographyId) => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: geographyType,
      geography_id: geographyId,
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_id_shape' },
    });
    expect(mockGetAreaSegments).not.toHaveBeenCalled();
  });

  it('throws invalid_geography_id_shape for a non-numeric geography_id', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'state',
      geography_id: 'CA',
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_id_shape' },
      message: expect.stringContaining('not all digits'),
    });
  });

  it.each([
    ['state', '06'],
    ['county', '06037'],
    ['cd', '0601'],
    ['cbsa', '31080'],
    ['place', '0644000'],
  ])('accepts geography_type="%s" with well-shaped id "%s"', async (geographyType, geographyId) => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: geographyType,
      geography_id: geographyId,
    });
    const result = await getCoverageSummaryTool.handler(input, ctx);
    expect(result.geography.id).toBe(geographyId);
    expect(mockGetAreaSegments).toHaveBeenCalled();
  });

  it('leaves tribal geography_id unvalidated', async () => {
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'tribal',
      geography_id: 'T010',
    });
    const result = await getCoverageSummaryTool.handler(input, ctx);
    expect(result.geography.id).toBe('T010');
    expect(mockGetAreaSegments).toHaveBeenCalled();
  });

  it('throws geography_not_found when service returns empty segments', async () => {
    mockGetAreaSegments.mockResolvedValue([]);
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'state',
      geography_id: '99',
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'geography_not_found' },
    });
  });

  it('aggregates multiple segments correctly', async () => {
    const seg2 = { ...MOCK_SEGMENT, urbanRural: 'U' as const };
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT, seg2]);
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'state',
      geography_id: '28',
    });
    const result = await getCoverageSummaryTool.handler(input, ctx);
    expect(result.population.total).toBe(200000);
    expect(result.breakdown).toHaveLength(2);
  });

  it('formats output with all required fields', () => {
    const output = {
      geography: { type: 'state', id: '28', name: 'Mississippi' },
      techFilter: 'acfosw',
      speedDownMbps: 25,
      population: {
        noCoverage: 50000,
        oneProvider: 30000,
        twoProviders: 15000,
        threeOrMore: 5000,
        total: 100000,
      },
      coveragePct: 50,
      unservedPct: 50,
      competitivePct: 20,
      breakdown: [
        {
          urbanRural: 'R' as const,
          tribal: 'N' as const,
          population: {
            noCoverage: 50000,
            oneProvider: 30000,
            twoProviders: 15000,
            threeOrMore: 5000,
            total: 100000,
          },
          coveragePct: 50,
          unservedPct: 50,
        },
      ],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getCoverageSummaryTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Mississippi');
    expect(text).toContain('100,000');
    expect(text).toContain('50');
    expect(text).toContain('acfosw');
    expect(text).toContain('25');
    // breakdown row fields
    expect(text).toContain('50,000');
    expect(text).toContain('30,000');
    expect(text).toContain('15,000');
    expect(text).toContain('5,000');
  });
});
