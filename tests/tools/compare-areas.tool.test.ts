/**
 * @fileoverview Tests for the fcc_compare_areas tool.
 * @module tests/tools/compare-areas.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareAreasTool } from '@/mcp-server/tools/definitions/compare-areas.tool.js';

const mockGetAreaStatsBatch = vi.fn();
const mockGetGeographyNames = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({
    getAreaStatsBatch: mockGetAreaStatsBatch,
    getGeographyNames: mockGetGeographyNames,
  }),
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

/**
 * Three areas whose metric orderings deliberately disagree: '56' is worst by
 * unserved share, '28' by raw unserved headcount, and '01' by competitive
 * share. Coverage share is the exact complement of unserved share, so those two
 * orderings are identical by construction — the distinguishing signal for
 * coverage_pct is its direction, not its sequence.
 */
const SORT_STATS = [
  {
    // unserved 42.9% · 300,000 people · competitive 28.6%
    id: '28',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 300_000,
    oneProvider: 200_000,
    twoProviders: 150_000,
    threeOrMore: 50_000,
    total: 700_000,
  },
  {
    // unserved 27.3% · 150,000 people · competitive 9.1%
    id: '01',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 150_000,
    oneProvider: 350_000,
    twoProviders: 40_000,
    threeOrMore: 10_000,
    total: 550_000,
  },
  {
    // unserved 80.0% · 8,000 people · competitive 10.0%
    id: '56',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 8_000,
    oneProvider: 1_000,
    twoProviders: 500,
    threeOrMore: 500,
    total: 10_000,
  },
];

describe('compareAreasTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaStatsBatch.mockResolvedValue(MOCK_STATS);
    mockGetGeographyNames.mockResolvedValue(new Map());
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
    expect(result.areas[0]!.id).toBe('28');
    expect(result.areas[0]!.rank).toBe(1);
    // enrichment
    expect(getEnrichment(ctx)).toMatchObject({ appliedFilters: { areasCompared: 2 } });
  });

  it('uses all 50 states when compare_all_states=true', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      compare_all_states: true,
    });
    await compareAreasTool.handler(input, ctx);
    const callArgs = mockGetAreaStatsBatch.mock.calls[0]![0] as { geographyIds: string[] };
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
    expect(result.areas[0]!.noCoverage).toBeGreaterThanOrEqual(result.areas[1]!.noCoverage);
  });

  describe('sort direction (rank 1 = worst)', () => {
    /** Run a comparison over SORT_STATS and return the resulting GEOID order. */
    async function rankedIds(sortBy: string): Promise<string[]> {
      mockGetAreaStatsBatch.mockResolvedValue(SORT_STATS);
      const ctx = createMockContext({ errors: compareAreasTool.errors });
      const input = compareAreasTool.input.parse({
        geography_type: 'state',
        geography_ids: ['28', '01', '56'],
        sort_by: sortBy,
      });
      const result = await compareAreasTool.handler(input, ctx);
      expect(result.areas.map((a) => a.rank)).toEqual([1, 2, 3]);
      return result.areas.map((a) => a.id);
    }

    it('ranks the largest unserved share first for unserved_pct', async () => {
      // 80.0% → 42.9% → 27.3%
      await expect(rankedIds('unserved_pct')).resolves.toEqual(['56', '28', '01']);
    });

    it('ranks the largest unserved headcount first for unserved_pop', async () => {
      // 300,000 → 150,000 → 8,000
      await expect(rankedIds('unserved_pop')).resolves.toEqual(['28', '01', '56']);
    });

    it('ranks the lowest coverage share first for coverage_pct', async () => {
      // 20.0% → 57.1% → 72.7%
      await expect(rankedIds('coverage_pct')).resolves.toEqual(['56', '28', '01']);
    });

    it('ranks the lowest competitive share first for competitive_pct', async () => {
      // 9.1% → 10.0% → 28.6%
      await expect(rankedIds('competitive_pct')).resolves.toEqual(['01', '56', '28']);
    });
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

  it('rejects a mis-shaped geography_ids entry before the batch call', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'county',
      geography_ids: ['28107', '28'],
    });
    await expect(compareAreasTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_id_shape' },
    });
    expect(mockGetAreaStatsBatch).not.toHaveBeenCalled();
  });

  it('rejects county FIPS entries passed as state with the cross-hint', async () => {
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['06037', '28'],
    });
    await expect(compareAreasTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_geography_id_shape' },
      message: expect.stringContaining('county FIPS'),
    });
    expect(mockGetAreaStatsBatch).not.toHaveBeenCalled();
  });

  it('leaves tribal geography_ids unvalidated', async () => {
    mockGetAreaStatsBatch.mockResolvedValue(
      MOCK_STATS.map((s, i) => ({ ...s, id: ['T010', 'T02'][i] ?? s.id, type: 'tribal' })),
    );
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'tribal',
      geography_ids: ['T010', 'T02'],
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas).toHaveLength(2);
    expect(mockGetAreaStatsBatch).toHaveBeenCalled();
  });

  it('resolves geography names into rows and format output', async () => {
    mockGetGeographyNames.mockResolvedValue(
      new Map([
        ['28', 'Mississippi'],
        ['01', 'Alabama'],
      ]),
    );
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['28', '01'],
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas[0]!.name).toBe('Mississippi');
    expect(result.areas[1]!.name).toBe('Alabama');
    const blocks = compareAreasTool.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Name (GEOID)');
    expect(text).toContain('Mississippi (28)');
  });

  it('omits name for a GEOID with no lookup match', async () => {
    mockGetGeographyNames.mockResolvedValue(new Map([['28', 'Mississippi']]));
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['28', '01'],
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas[0]!.name).toBe('Mississippi');
    expect(result.areas[1]!.name).toBeUndefined();
  });

  it('succeeds without names when name resolution fails', async () => {
    mockGetGeographyNames.mockRejectedValue(new Error('lookup unavailable'));
    const ctx = createMockContext({ errors: compareAreasTool.errors });
    const input = compareAreasTool.input.parse({
      geography_type: 'state',
      geography_ids: ['28', '01'],
    });
    const result = await compareAreasTool.handler(input, ctx);
    expect(result.areas).toHaveLength(2);
    expect(result.areas.every((a) => a.name === undefined)).toBe(true);
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

  describe('sort direction on the markdown surface', () => {
    /** Minimal output carrying one row, ranked by `sortBy`. */
    function outputSortedBy(sortBy: string) {
      return {
        geographyType: 'state',
        techFilter: 'acfosw',
        speedDownMbps: 25,
        sortBy,
        areas: [
          {
            id: '56',
            rank: 1,
            noCoverage: 8000,
            oneProvider: 1000,
            twoProviders: 500,
            threeOrMore: 500,
            total: 10000,
            unservedPct: 80,
            coveragePct: 20,
            competitivePct: 10,
          },
        ],
        totalAreas: 1,
        dataVintage: 'June 2021 (last Form 477 filing period)',
      };
    }

    /** The rendered `content[]` markdown for a comparison sorted by `sortBy`. */
    function render(sortBy: string): string {
      const blocks = compareAreasTool.format!(outputSortedBy(sortBy));
      return (blocks[0] as { text: string }).text;
    }

    /*
     * Coverage share and unserved share are exact complements, so the two
     * rankings are always the same sequence — only the stated direction tells a
     * reader whether a coverage_pct table led by the LOWEST coverage is the
     * intended worst-first order or a reversed comparator.
     */
    it.each([
      ['unserved_pct', 'highest unserved share'],
      ['unserved_pop', 'largest unserved population'],
      ['coverage_pct', 'lowest coverage share'],
      ['competitive_pct', 'lowest competitive share'],
    ])('says what rank 1 means when sorted by %s', (sortBy, rank1) => {
      const text = render(sortBy);
      expect(text).toContain('worst first');
      expect(text).toContain(`rank 1 has the ${rank1}`);
    });

    it('still names the metric it sorted by', () => {
      expect(render('coverage_pct')).toContain('Coverage %');
    });

    it('claims no direction for an unrecognized sort key', () => {
      const text = render('something_else');
      expect(text).toContain('something_else');
      expect(text).not.toContain('worst first');
      expect(text).not.toContain('rank 1 has the');
    });

    it('reaches the markdown surface through the full tool pipeline', async () => {
      mockGetAreaStatsBatch.mockResolvedValue(SORT_STATS);
      const result = await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: ['28', '01', '56'],
        sort_by: 'coverage_pct',
      });
      const markdown = (result.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');

      expect(markdown).toContain('rank 1 has the lowest coverage share');
      // The ranking itself is unchanged: worst coverage (20%) still leads.
      expect(markdown.indexOf('| 1 | 56 |')).toBeGreaterThan(-1);
    });

    it('leaves structuredContent free of the rendered direction text', async () => {
      mockGetAreaStatsBatch.mockResolvedValue(SORT_STATS);
      const result = await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: ['28', '01', '56'],
        sort_by: 'coverage_pct',
      });
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.sortBy).toBe('coverage_pct');
      expect(JSON.stringify(structured)).not.toContain('worst first');
    });
  });
});
