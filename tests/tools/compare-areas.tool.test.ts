/**
 * @fileoverview Tests for the fcc_compare_areas tool.
 * @module tests/tools/compare-areas.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareAreasTool } from '@/mcp-server/tools/definitions/compare-areas.tool.js';

const mockGetAreaStatsBatch = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ getAreaStatsBatch: mockGetAreaStatsBatch }),
}));

const MOCK_STATS = [
  {
    id: '28',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 300000,
    oneProvider: 200000,
    twoProviders: 150000,
    threeOrMore: 50000,
    total: 700000,
  },
  {
    id: '01',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 150000,
    oneProvider: 100000,
    twoProviders: 200000,
    threeOrMore: 100000,
    total: 550000,
  },
];

describe('compareAreasTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaStatsBatch.mockResolvedValue(MOCK_STATS);
  });

  it('returns ranked areas for a list of geography IDs', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['28', '01'],
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas).toHaveLength(2);
    // sorted by unserved_pct descending — 28 has higher unserved%
    expect(result.areas[0].id).toBe('28');
    expect(result.areas[0].rank).toBe(1);
    // enrichment
    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters).toBeDefined();
    expect(enrichment.appliedFilters.areasCompared).toBe(2);
  });

  it('uses all 50 states when compare_all_states=true', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      compare_all_states: true,
    });
    await compareAreasTool.handler(input, ctx);
    const callArgs = mockGetAreaStatsBatch.mock.calls[0][0] as { geographyIds: string[] };
    expect(callArgs.geographyIds.length).toBe(51); // 50 states + DC
  });

  it('sorts by unserved_pop when specified', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['28', '01'],
      sort_by: 'unserved_pop',
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas[0].noCoverage).toBeGreaterThanOrEqual(result.areas[1].noCoverage);
  });

  it('throws invalid_all_states_combo when compare_all_states=true with non-state type', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'county',
      compare_all_states: true,
    });
    await expect(compareAreasTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_all_states_combo' },
    });
  });

  it('throws when fewer than 2 geography_ids provided (Zod .min(2))', () => {
    // Zod rejects single-item arrays at parse time — no handler invocation needed
    expect(() =>
      compareAreasTool.input.parse({
        geography_type: 'state',
        geography_ids: ['28'],
      }),
    ).toThrow();
  });

  it('throws missing_geography_ids when no geography_ids and compare_all_states is false', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    // geography_ids defaults to undefined, compare_all_states defaults to false
    // geoIds will be [] which has length < 2
    const input = {
      geography_type: 'county' as const,
      tech_filter: 'acfosw' as const,
      speed_down: '25' as const,
      sort_by: 'unserved_pct' as const,
      compare_all_states: false,
    };
    await expect(compareAreasTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'missing_geography_ids' },
    });
  });

  it('throws no_data_found when service returns empty array', async () => {
    mockGetAreaStatsBatch.mockResolvedValue([]);
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['99', '98'],
    });
    await expect(compareAreasTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'no_data_found' },
    });
  });

  it('formats output with rank, oneProvider, twoProviders, threeOrMore columns', () => {
    const output = {
      geographyType: 'state',
      techFilter: 'acfosw',
      speedDownMbps: 25,
      sortBy: 'unserved_pct',
      areas: [
        {
          id: '28',
          rank: 1,
          noCoverage: 300000,
          oneProvider: 200000,
          twoProviders: 150000,
          threeOrMore: 50000,
          total: 700000,
          unservedPct: 42.9,
          coveragePct: 57.1,
          competitivePct: 28.6,
        },
      ],
      totalAreas: 1,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = compareAreasTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('28');
    expect(text).toContain('300,000');
    expect(text).toContain('200,000');
    expect(text).toContain('150,000');
    expect(text).toContain('50,000');
    expect(text).toContain('42.9');
    expect(text).toContain('acfosw');
  });
});
