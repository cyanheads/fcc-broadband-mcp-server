/**
 * @fileoverview Tests for the fcc-broadband://geography/{type}/{id}/summary resource.
 * @module tests/resources/geography-summary.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geographySummaryResource } from '@/mcp-server/resources/definitions/geography-summary.resource.js';

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

describe('geographySummaryResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT]);
    mockGetGeographyName.mockResolvedValue('Mississippi');
  });

  // Happy path — state
  it('returns coverage summary for a state geography', async () => {
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '28' }, ctx);
    expect(result.geography.type).toBe('state');
    expect(result.geography.id).toBe('28');
    expect(result.geography.name).toBe('Mississippi');
    expect(result.population.total).toBe(100000);
    expect(result.population.noCoverage).toBe(50000);
    expect(result.unservedPct).toBe(50);
    expect(result.coveragePct).toBe(50);
    expect(result.competitivePct).toBe(20);
    expect(result.dataVintage).toContain('2021');
  });

  // Happy path — nation (id normalised to '0')
  it('returns nation-level summary and normalises id to "0"', async () => {
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'nation', id: '0' }, ctx);
    expect(result.geography.type).toBe('nation');
    expect(result.geography.id).toBe('0');
  });

  // Happy path — county
  it('returns county summary', async () => {
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'county', id: '28049' }, ctx);
    expect(result.geography.type).toBe('county');
    expect(result.geography.id).toBe('28049');
    expect(result.segments).toHaveLength(1);
  });

  // All valid geography types
  it.each(['nation', 'state', 'county', 'cd', 'place', 'cbsa', 'tribal'])(
    'accepts valid geography type "%s"',
    async (geoType) => {
      const ctx = createMockContext();
      const result = await geographySummaryResource.handler({ type: geoType, id: '01' }, ctx);
      expect(result.geography.type).toBe(geoType);
    },
  );

  // Invalid geography type throws
  it('throws ValidationError for unrecognised geography type', async () => {
    const ctx = createMockContext();
    await expect(
      geographySummaryResource.handler({ type: 'zipcode', id: '98101' }, ctx),
    ).rejects.toThrow(/Invalid geography type/);
  });

  it('throws ValidationError for empty string type', async () => {
    const ctx = createMockContext();
    await expect(geographySummaryResource.handler({ type: '', id: '28' }, ctx)).rejects.toThrow();
  });

  // Percentages are computed correctly
  it('computes coveragePct, unservedPct, and competitivePct from segments', async () => {
    mockGetAreaSegments.mockResolvedValue([
      {
        urbanRural: 'U' as const,
        tribal: 'N' as const,
        population: {
          noCoverage: 0,
          oneProvider: 0,
          twoProviders: 40000,
          threeOrMore: 60000,
          total: 100000,
        },
        coveragePct: 100,
        unservedPct: 0,
        competitivePct: 100,
      },
    ]);
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '06' }, ctx);
    expect(result.unservedPct).toBe(0);
    expect(result.coveragePct).toBe(100);
    expect(result.competitivePct).toBe(100);
  });

  it('returns zero percentages when total population is 0', async () => {
    mockGetAreaSegments.mockResolvedValue([
      {
        urbanRural: 'R' as const,
        tribal: 'N' as const,
        population: {
          noCoverage: 0,
          oneProvider: 0,
          twoProviders: 0,
          threeOrMore: 0,
          total: 0,
        },
        coveragePct: 0,
        unservedPct: 0,
        competitivePct: 0,
      },
    ]);
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '00' }, ctx);
    expect(result.coveragePct).toBe(0);
    expect(result.unservedPct).toBe(0);
    expect(result.competitivePct).toBe(0);
  });

  // Aggregates multiple segments
  it('aggregates population across multiple segments', async () => {
    const seg2 = {
      ...MOCK_SEGMENT,
      urbanRural: 'U' as const,
      population: {
        noCoverage: 10000,
        oneProvider: 20000,
        twoProviders: 30000,
        threeOrMore: 40000,
        total: 100000,
      },
    };
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT, seg2]);
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '28' }, ctx);
    expect(result.population.total).toBe(200000);
    expect(result.population.noCoverage).toBe(60000);
    expect(result.segments).toHaveLength(2);
  });

  // Geography name failure is non-fatal
  it('continues without geography name if getGeographyName rejects', async () => {
    mockGetGeographyName.mockRejectedValue(new Error('lookup failed'));
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '28' }, ctx);
    expect(result.geography.name).toBeUndefined();
    expect(result.population.total).toBe(100000);
  });

  // Segment shape in output
  it('maps segment urbanRural and tribal fields correctly', async () => {
    const tribalSeg = {
      ...MOCK_SEGMENT,
      urbanRural: 'R' as const,
      tribal: 'T' as const,
    };
    mockGetAreaSegments.mockResolvedValue([tribalSeg]);
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'tribal', id: '123' }, ctx);
    expect(result.segments[0]!.urbanRural).toBe('R');
    expect(result.segments[0]!.tribal).toBe('T');
  });

  // Percentages rounded to 1 decimal
  it('rounds percentages to one decimal place', async () => {
    mockGetAreaSegments.mockResolvedValue([
      {
        urbanRural: 'R' as const,
        tribal: 'N' as const,
        population: {
          noCoverage: 1,
          oneProvider: 0,
          twoProviders: 0,
          threeOrMore: 2,
          total: 3,
        },
        coveragePct: 66.7,
        unservedPct: 33.3,
        competitivePct: 66.7,
      },
    ]);
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '01' }, ctx);
    // 1/3 = 33.333... → 33.3
    const decimalPlaces = (result.unservedPct.toString().split('.')[1] ?? '').length;
    expect(decimalPlaces).toBeLessThanOrEqual(1);
  });

  // Security — injection-like type string
  it('throws on type strings that contain path traversal characters', async () => {
    const ctx = createMockContext();
    await expect(
      geographySummaryResource.handler({ type: '../etc/passwd', id: '28' }, ctx),
    ).rejects.toThrow(/Invalid geography type/);
  });

  it('throws on type string with SQL-injection-like content', async () => {
    const ctx = createMockContext();
    await expect(
      geographySummaryResource.handler({ type: "state' OR '1'='1", id: '28' }, ctx),
    ).rejects.toThrow(/Invalid geography type/);
  });

  // Security — no secret values in output
  it('does not expose environment variable names in output', async () => {
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '28' }, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/API_KEY/i);
    expect(serialized).not.toMatch(/FCC_BDC/i);
    expect(serialized).not.toMatch(/PASSWORD/i);
  });

  // dataVintage always present
  it('includes dataVintage in output', async () => {
    const ctx = createMockContext();
    const result = await geographySummaryResource.handler({ type: 'state', id: '28' }, ctx);
    expect(typeof result.dataVintage).toBe('string');
    expect(result.dataVintage.length).toBeGreaterThan(0);
  });
});
