/**
 * @fileoverview Tests for the fcc_find_underserved tool.
 * @module tests/tools/find-underserved.tool.test
 */

import { JsonRpcErrorCode, type McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findUnderservedTool } from '@/mcp-server/tools/definitions/find-underserved.tool.js';

const mockGetAreaStatsByType = vi.fn();
const mockGetGeographyNames = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({
    getAreaStatsByType: mockGetAreaStatsByType,
    getGeographyNames: mockGetGeographyNames,
  }),
}));

const MOCK_STATS = [
  {
    id: '28049',
    noCoverage: 30000,
    oneProvider: 20000,
    twoProviders: 5000,
    threeOrMore: 1000,
    total: 56000,
  },
  {
    id: '28071',
    noCoverage: 15000,
    oneProvider: 10000,
    twoProviders: 3000,
    threeOrMore: 500,
    total: 28500,
  },
  {
    id: '28001',
    noCoverage: 5000,
    oneProvider: 8000,
    twoProviders: 2000,
    threeOrMore: 500,
    total: 15500,
  },
];

/** One genuinely underserved area alongside two that are fully covered. */
const WITH_FULLY_COVERED = [
  {
    id: '28049',
    noCoverage: 30000,
    oneProvider: 20000,
    twoProviders: 5000,
    threeOrMore: 1000,
    total: 56000,
  },
  {
    id: '53001',
    noCoverage: 0,
    oneProvider: 1200,
    twoProviders: 800,
    threeOrMore: 400,
    total: 2400,
  },
  {
    id: '53003',
    noCoverage: 0,
    oneProvider: 900,
    twoProviders: 600,
    threeOrMore: 300,
    total: 1800,
  },
];

/** The scan envelope getAreaStatsByType returns — complete unless overridden. */
function scan(
  stats: unknown[],
  overrides: { scanTruncated?: boolean; scanRowCap?: number } = {},
): Record<string, unknown> {
  return { stats, scanTruncated: false, scanRowCap: 50_000, ...overrides };
}

describe('findUnderservedTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaStatsByType.mockResolvedValue(scan(MOCK_STATS));
    mockGetGeographyNames.mockResolvedValue(new Map());
  });

  it('returns underserved areas ranked by noCoverage descending', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county' });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas[0]!.id).toBe('28049');
    expect(result.areas[0]!.rank).toBe(1);
    expect(result.areas[0]!.noCoverage).toBe(30000);
    expect(getEnrichment(ctx).totalFound).toBe(3);
  });

  it('filters by min_unserved_pop', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({
      geography_type: 'county',
      min_unserved_pop: 10000,
    });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas.length).toBe(2);
    expect(result.areas.every((a) => a.noCoverage >= 10000)).toBe(true);
  });

  describe('fully covered areas', () => {
    beforeEach(() => {
      mockGetAreaStatsByType.mockResolvedValue(scan(WITH_FULLY_COVERED));
    });

    it('excludes zero-unserved areas under the default min_unserved_pop', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      const result = await findUnderservedTool.handler(input, ctx);
      expect(result.areas.map((a) => a.id)).toEqual(['28049']);
      expect(getEnrichment(ctx).totalFound).toBe(1);
    });

    it('echoes the applied min_unserved_pop default of 1', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      await findUnderservedTool.handler(input, ctx);
      expect(getEnrichment(ctx).appliedFilters).toMatchObject({ minUnservedPop: 1 });
    });

    it('keeps zero-unserved areas but discloses them at min_unserved_pop 0', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({
        geography_type: 'county',
        min_unserved_pop: 0,
      });
      const result = await findUnderservedTool.handler(input, ctx);
      expect(result.areas).toHaveLength(3);
      expect(result.areas.filter((a) => a.noCoverage === 0)).toHaveLength(2);
      expect(String(getEnrichment(ctx).notice)).toMatch(/no unserved population/i);
    });

    it('says nothing about zero-unserved rows when none are returned', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({
        geography_type: 'county',
        min_unserved_pop: 0,
        limit: 1,
      });
      const result = await findUnderservedTool.handler(input, ctx);
      expect(result.areas.map((a) => a.id)).toEqual(['28049']);
      expect(String(getEnrichment(ctx).notice)).not.toMatch(/no unserved population/i);
    });

    it('composes the list cap and the zero-unserved disclosure into one notice', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({
        geography_type: 'county',
        min_unserved_pop: 0,
        limit: 2,
      });
      await findUnderservedTool.handler(input, ctx);
      const enrichment = getEnrichment(ctx);
      expect(enrichment).toMatchObject({ truncated: true, shown: 2, cap: 2 });
      expect(String(enrichment.notice)).toMatch(/Showing the top 2 of 3/);
      expect(String(enrichment.notice)).toMatch(/no unserved population/i);
    });

    it('returns an empty ranking when every area is fully covered', async () => {
      mockGetAreaStatsByType.mockResolvedValue(scan(WITH_FULLY_COVERED.slice(1)));
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      const result = await findUnderservedTool.handler(input, ctx);
      expect(result.areas).toHaveLength(0);
      expect(String(getEnrichment(ctx).notice)).toContain('min_unserved_pop');
    });
  });

  it('respects limit parameter', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({
      geography_type: 'county',
      limit: 1,
    });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas).toHaveLength(1);
    expect(getEnrichment(ctx).totalFound).toBe(3);
  });

  it('returns empty areas with notice in enrichment when no data after filter', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({
      geography_type: 'county',
      min_unserved_pop: 999999,
    });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas).toHaveLength(0);
    expect(getEnrichment(ctx).notice).toBeDefined();
  });

  describe('upstream row scan', () => {
    it('imposes no row budget of its own on the scan', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      await findUnderservedTool.handler(input, ctx);
      const callArgs = mockGetAreaStatsByType.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('limit');
    });

    it('discloses a truncated scan through enrichment and the notice', async () => {
      mockGetAreaStatsByType.mockResolvedValue(
        scan(MOCK_STATS, { scanTruncated: true, scanRowCap: 50_000 }),
      );
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      const result = await findUnderservedTool.handler(input, ctx);

      expect(result.areas).toHaveLength(3);
      const enrichment = getEnrichment(ctx);
      expect(enrichment.scanTruncated).toBe(true);
      expect(enrichment.scanRowCap).toBe(50_000);
      expect(String(enrichment.notice)).toContain('50,000');
    });

    it('leaves the scan-truncation fields absent when the scan was complete', async () => {
      const ctx = createMockContext({ errors: findUnderservedTool.errors });
      const input = findUnderservedTool.input.parse({ geography_type: 'county' });
      await findUnderservedTool.handler(input, ctx);
      const enrichment = getEnrichment(ctx);
      expect(enrichment.scanTruncated).toBeUndefined();
      expect(enrichment.scanRowCap).toBeUndefined();
    });
  });

  it('forwards state abbreviation as FIPS prefix to service', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({
      geography_type: 'county',
      state: 'WA',
    });
    await findUnderservedTool.handler(input, ctx);
    const callArgs = mockGetAreaStatsByType.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty('stateFipsPrefix', '53');
  });

  it('forwards a territory abbreviation as its FIPS prefix', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county', state: 'PR' });
    await findUnderservedTool.handler(input, ctx);
    const callArgs = mockGetAreaStatsByType.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty('stateFipsPrefix', '72');
  });

  it('rejects a well-formed but unrecognized state code instead of going nationwide', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county', state: 'XX' });
    await expect(findUnderservedTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'unknown_state' },
    });
    expect(mockGetAreaStatsByType).not.toHaveBeenCalled();
  });

  it('carries a recovery hint naming both fixes for an unrecognized state code', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county', state: 'ZZ' });
    const error = await Promise.resolve(findUnderservedTool.handler(input, ctx)).catch(
      (e: unknown) => e,
    );
    const hint = (error as McpError).data?.recovery as { hint: string } | undefined;
    expect(hint?.hint).toMatch(/abbreviation/i);
    expect(hint?.hint).toMatch(/omit/i);
  });

  it('does not set stateFipsPrefix when state is omitted', async () => {
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county' });
    await findUnderservedTool.handler(input, ctx);
    const callArgs = mockGetAreaStatsByType.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs.stateFipsPrefix).toBeUndefined();
  });

  it('resolves geography names for returned rows only (post-limit)', async () => {
    mockGetGeographyNames.mockResolvedValue(new Map([['28049', 'Hinds County, MS']]));
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({
      geography_type: 'county',
      limit: 1,
    });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas[0]!.name).toBe('Hinds County, MS');
    expect(mockGetGeographyNames).toHaveBeenCalledWith('county', ['28049'], expect.anything());
  });

  it('omits name for a GEOID with no lookup match', async () => {
    mockGetGeographyNames.mockResolvedValue(new Map([['28049', 'Hinds County, MS']]));
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county' });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas[0]!.name).toBe('Hinds County, MS');
    expect(result.areas[1]!.name).toBeUndefined();
  });

  it('succeeds without names when name resolution fails', async () => {
    mockGetGeographyNames.mockRejectedValue(new Error('lookup unavailable'));
    const ctx = createMockContext({ errors: findUnderservedTool.errors });
    const input = findUnderservedTool.input.parse({ geography_type: 'county' });
    const result = await findUnderservedTool.handler(input, ctx);
    expect(result.areas).toHaveLength(3);
    expect(result.areas.every((a) => a.name === undefined)).toBe(true);
  });

  it('renders resolved names in the format table', () => {
    const output = {
      areas: [
        {
          id: '28049',
          name: 'Hinds County, MS',
          rank: 1,
          noCoverage: 30000,
          oneProvider: 20000,
          total: 56000,
          unservedPct: 53.6,
          coveragePct: 46.4,
        },
      ],
      geographyType: 'county',
      speedDownMbps: 25,
      urbanRuralFilter: 'R',
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = findUnderservedTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Name (GEOID)');
    expect(text).toContain('Hinds County, MS (28049)');
  });

  it('formats output with rank, unserved, and oneProvider columns', () => {
    const output = {
      areas: [
        {
          id: '28049',
          rank: 1,
          noCoverage: 30000,
          oneProvider: 20000,
          total: 56000,
          unservedPct: 53.6,
          coveragePct: 46.4,
        },
      ],
      totalFound: 1,
      geographyType: 'county',
      speedDownMbps: 25,
      urbanRuralFilter: 'R',
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = findUnderservedTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('28049');
    expect(text).toContain('30,000');
    expect(text).toContain('20,000');
    expect(text).toContain('53.6');
    expect(text).toContain('R');
    expect(text).toContain('county');
    expect(text).toContain('25');
  });

  /*
   * The disclosure this tool computes lives in `enrichment`, which `format()`
   * never receives — the framework mirrors it into `content[]` as a trailer
   * after `format()` runs. These cases assert on that joined markdown, the
   * whole of what a `content[]`-only client reads, so the disclosure is pinned
   * on the surface a reader actually sees rather than only in the store.
   */
  describe('markdown surface (content[])', () => {
    /** Every text block of the real dual-surface result, joined as one document. */
    async function renderMarkdown(input: Record<string, unknown>): Promise<string> {
      const result = await runToolContract(findUnderservedTool, input);
      return (result.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
    }

    it('names the match total in words, not as a raw field key', async () => {
      const markdown = await renderMarkdown({ geography_type: 'county' });
      expect(markdown).toContain('**Total matching areas:** 3');
      expect(markdown).not.toContain('totalFound');
    });

    it('discloses the list cap when more areas matched than were shown', async () => {
      const markdown = await renderMarkdown({ geography_type: 'county', limit: 2 });
      expect(markdown).toContain('**Areas shown:** 2');
      expect(markdown).toContain('**Limit applied:** 2');
      expect(markdown).toContain('**List truncated:** true');
      expect(markdown).toContain('Showing the top 2 of 3 matching areas');
      expect(markdown).not.toContain('**shown:**');
      expect(markdown).not.toContain('**cap:**');
    });

    it('names the scan row ceiling with separators when the scan truncated', async () => {
      mockGetAreaStatsByType.mockResolvedValue(scan(MOCK_STATS, { scanTruncated: true }));
      const markdown = await renderMarkdown({ geography_type: 'county' });
      expect(markdown).toContain('**Upstream scan truncated:** true');
      expect(markdown).toContain('**Scan row ceiling:** 50,000');
      expect(markdown).not.toContain('scanRowCap');
      expect(markdown).not.toContain('50000');
    });

    it('discloses fully covered rows on the markdown surface', async () => {
      mockGetAreaStatsByType.mockResolvedValue(scan(WITH_FULLY_COVERED));
      const markdown = await renderMarkdown({
        geography_type: 'county',
        min_unserved_pop: 0,
      });
      expect(markdown).toMatch(/no unserved population at 25 Mbps/);
      expect(markdown).toContain('**Min unserved pop:** 0');
    });

    it('discloses an empty ranking and how to broaden it', async () => {
      const markdown = await renderMarkdown({
        geography_type: 'county',
        min_unserved_pop: 999999,
      });
      expect(markdown).toContain('No underserved areas found with current filters.');
      expect(markdown).toContain('**Total matching areas:** 0');
      expect(markdown).toContain('Try lowering min_unserved_pop');
    });

    it('carries all three disclosures at once when all three apply', async () => {
      mockGetAreaStatsByType.mockResolvedValue(scan(WITH_FULLY_COVERED, { scanTruncated: true }));
      const markdown = await renderMarkdown({
        geography_type: 'county',
        min_unserved_pop: 0,
        limit: 2,
      });
      expect(markdown).toContain('Showing the top 2 of 3 matching areas');
      expect(markdown).toContain('50,000-row ceiling');
      expect(markdown).toMatch(/no unserved population/);
      expect(markdown).toContain('**Scan row ceiling:** 50,000');
    });

    it('adds no truncation or scan lines when there is nothing to disclose', async () => {
      const markdown = await renderMarkdown({ geography_type: 'county' });
      expect(markdown).not.toContain('List truncated');
      expect(markdown).not.toContain('Areas shown');
      expect(markdown).not.toContain('Limit applied');
      expect(markdown).not.toContain('Upstream scan truncated');
      expect(markdown).not.toContain('Scan row ceiling');
      // No stray blockquote — the notice is the only source of one.
      expect(markdown).not.toContain('\n> ');
    });

    it('leaves structuredContent carrying the raw declared field names', async () => {
      mockGetAreaStatsByType.mockResolvedValue(scan(MOCK_STATS, { scanTruncated: true }));
      const result = await runToolContract(findUnderservedTool, {
        geography_type: 'county',
        limit: 2,
      });
      // The trailer labels are presentation only; the wire contract is unchanged.
      expect(result.structuredContent).toMatchObject({
        totalFound: 3,
        truncated: true,
        shown: 2,
        cap: 2,
        scanTruncated: true,
        scanRowCap: 50_000,
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain('Scan row ceiling');
    });
  });
});
