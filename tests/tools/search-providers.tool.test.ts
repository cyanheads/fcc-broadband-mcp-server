/**
 * @fileoverview Tests for the fcc_search_providers tool.
 * @module tests/tools/search-providers.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchProvidersTool } from '@/mcp-server/tools/definitions/search-providers.tool.js';
import type { ProviderRecord, ProviderSearchResult } from '@/services/open-data/types.js';

const mockSearchProviders = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ searchProviders: mockSearchProviders }),
}));

const MOCK_PROVIDERS: ProviderRecord[] = [
  {
    hoconum: '130152',
    holdingCompanyName: 'Comcast',
    statesServed: ['WA', 'CA'],
    techCodes: ['41', '50'],
  },
];

/** A complete scan returning `providers` — the shape the mirror path produces. */
function completeScan(providers: ProviderRecord[] = MOCK_PROVIDERS): ProviderSearchResult {
  return { matched: providers.length, providers, scanRowCap: 500, scanTruncated: false };
}

/** A live scan that filled its window, so `providers` is a sample of the match. */
function sampledScan(providers: ProviderRecord[] = MOCK_PROVIDERS): ProviderSearchResult {
  return { matched: providers.length, providers, scanRowCap: 1_000, scanTruncated: true };
}

describe('searchProvidersTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchProviders.mockResolvedValue(completeScan());
  });

  it('returns providers for a name search', async () => {
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({ name_search: 'Comcast' });
    const result = await searchProvidersTool.handler(input, ctx);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.hoconum).toBe('130152');
    expect(result.totalFound).toBe(1);
  });

  it('returns empty result with notice in enrichment when no providers found', async () => {
    mockSearchProviders.mockResolvedValue(completeScan([]));
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({
      name_search: 'NonexistentISP',
      state: 'WA',
    });
    const result = await searchProvidersTool.handler(input, ctx);
    expect(result.providers).toHaveLength(0);
    expect(result.totalFound).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('NonexistentISP');
  });

  it('notices an empty unfiltered search without naming absent criteria', async () => {
    mockSearchProviders.mockResolvedValue(completeScan([]));
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({});
    await searchProvidersTool.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toContain('No providers matched.');
    expect(enrichment.notice).not.toContain('undefined');
  });

  it('points an empty name-plus-filing search at the whole-company answer', async () => {
    mockSearchProviders.mockResolvedValue(completeScan([]));
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({ name_search: 'Comcast', tech_filter: ['40'] });
    await searchProvidersTool.handler(input, ctx);

    /*
     * The filters meet on one deployment filing, and a holding company number
     * can file a technology under an acquired brand name — so this pairing comes
     * back empty while each half matches alone. Generic "remove filters"
     * guidance leaves the caller believing the company lacks the technology.
     */
    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('one deployment filing together');
    expect(notice).toContain('acquired brand name');
    expect(notice).toContain('name="Comcast" alone');
  });

  it('gives generic filter guidance for an empty search with no name', async () => {
    mockSearchProviders.mockResolvedValue(completeScan([]));
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({ state: 'WA', tech_filter: ['60'] });
    await searchProvidersTool.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('Try a shorter name fragment or remove filters.');
    expect(notice).not.toContain('acquired brand name');
  });

  it('omits optional params from service call when not provided', async () => {
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({ limit: 50 });
    await searchProvidersTool.handler(input, ctx);
    const callArgs = mockSearchProviders.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('nameSearch');
    expect(callArgs).not.toHaveProperty('state');
    expect(callArgs).not.toHaveProperty('techCodes');
    expect(callArgs).toHaveProperty('limit', 50);
  });

  it('passes filters to service correctly', async () => {
    const ctx = createMockContext({ errors: searchProvidersTool.errors });
    const input = searchProvidersTool.input.parse({
      name_search: 'Comcast',
      state: 'WA',
      tech_filter: ['50'],
      limit: 10,
    });
    await searchProvidersTool.handler(input, ctx);
    expect(mockSearchProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        nameSearch: 'Comcast',
        state: 'WA',
        techCodes: ['50'],
        limit: 10,
      }),
      ctx,
    );
  });

  describe('sample disclosure', () => {
    it('reports the match count when the scan read every matching row', async () => {
      const ctx = createMockContext({ errors: searchProvidersTool.errors });
      await searchProvidersTool.handler(searchProvidersTool.input.parse({ state: 'WA' }), ctx);

      const enrichment = getEnrichment(ctx);
      expect(enrichment.totalCount).toBe(1);
      expect(enrichment.scanTruncated).toBeUndefined();
      expect(enrichment.scanRowCap).toBeUndefined();
    });

    it('withholds the match count and flags the scan when the window filled', async () => {
      mockSearchProviders.mockResolvedValue(sampledScan());
      const ctx = createMockContext({ errors: searchProvidersTool.errors });
      await searchProvidersTool.handler(searchProvidersTool.input.parse({ state: 'WA' }), ctx);

      const enrichment = getEnrichment(ctx);
      // A count taken from a partial scan is not the match count.
      expect(enrichment.totalCount).toBeUndefined();
      expect(enrichment.scanTruncated).toBe(true);
      expect(enrichment.scanRowCap).toBe(1_000);
      expect(enrichment.notice).toContain('sample');
      expect(enrichment.notice).toContain('1,000');
      expect(enrichment.notice).toContain('FCC_MIRROR_ENABLED');
    });

    it('scopes the sample to which companies came back, not what each one reports', async () => {
      mockSearchProviders.mockResolvedValue(sampledScan());
      const ctx = createMockContext({ errors: searchProvidersTool.errors });
      await searchProvidersTool.handler(searchProvidersTool.input.parse({ state: 'WA' }), ctx);

      /*
       * One account of what is and is not complete: the notice that calls the
       * list a sample has to say the per-provider detail is not one, or a reader
       * carries the caveat onto fields it does not cover.
       */
      const notice = getEnrichment(ctx).notice as string;
      expect(notice).toContain('complete national states and technologies');
      expect(notice).toContain('missing is companies, not detail');
    });

    it('settles every per-provider field as either whole-company or window-scoped', () => {
      const provider = searchProvidersTool.output.shape.providers.element;
      const described = (key: 'holdingCompanyName' | 'statesServed' | 'techCodes'): string =>
        provider.shape[key].description ?? '';

      // Resolved per company: every filtered search hands back a footprint
      // wider than its own filter, so the field says so where the reader meets it.
      expect(described('statesServed')).toContain('complete footprint');
      expect(described('statesServed')).toContain('Not narrowed by the state filter');
      expect(described('techCodes')).toContain('Not narrowed by tech_filter');
      // The one place a reader can see why fcc_get_provider may report fewer.
      expect(described('techCodes')).toContain('fcc_get_provider');

      // Read off the matched rows, not resolved: a hoconum can carry more than
      // one filed name, and this is the one the search matched.
      expect(described('holdingCompanyName')).toContain('deployment rows this search matched');
      expect(described('holdingCompanyName')).toContain('more than one name');
    });

    it('discloses the cap and the sample together when both apply', async () => {
      const providers = Array.from({ length: 5 }, (_, i) => ({
        hoconum: `13000${i}`,
        holdingCompanyName: `Provider ${i}`,
        statesServed: ['WA'],
        techCodes: ['50'],
      }));
      mockSearchProviders.mockResolvedValue({
        matched: 461,
        providers,
        scanRowCap: 1_000,
        scanTruncated: true,
      });
      const ctx = createMockContext({ errors: searchProvidersTool.errors });
      await searchProvidersTool.handler(
        searchProvidersTool.input.parse({ name_search: 'Tele', limit: 5 }),
        ctx,
      );

      const enrichment = getEnrichment(ctx);
      expect(enrichment.truncated).toBe(true);
      expect(enrichment.shown).toBe(5);
      expect(enrichment.cap).toBe(5);
      expect(enrichment.notice).toContain('Showing 5 of the 461');
      expect(enrichment.notice).toContain('sample');
    });

    it('does not flag truncation when the matches fit inside the limit', async () => {
      const ctx = createMockContext({ errors: searchProvidersTool.errors });
      await searchProvidersTool.handler(
        searchProvidersTool.input.parse({ name_search: 'Comcast', limit: 1 }),
        ctx,
      );

      const enrichment = getEnrichment(ctx);
      // One match, one slot — the list was filled, not cut short.
      expect(enrichment.truncated).toBeUndefined();
      expect(enrichment.notice).toBeUndefined();
    });

    it('renders the sample disclosure into content[] via the enrichment trailer', () => {
      const trailer = searchProvidersTool.enrichmentTrailer;
      expect(trailer?.scanTruncated?.label).toBe('Upstream scan truncated');
      expect(trailer?.scanRowCap?.render?.(1_000)).toBe('**Scan row ceiling:** 1,000');
    });
  });

  it('formats output with hoconum and provider names', () => {
    const output = {
      providers: MOCK_PROVIDERS,
      totalFound: 1,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = searchProvidersTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130152');
    expect(text).toContain('Comcast');
    expect(text).toContain('WA, CA');
    expect(text).toContain('41, 50');
    expect(text).toContain('Returned:** 1');
  });

  it('declares the non-retryable live_search_timeout contract entry', () => {
    const entry = searchProvidersTool.errors?.find((e) => e.reason === 'live_search_timeout');
    expect(entry).toBeDefined();
    expect(entry?.code).toBe(JsonRpcErrorCode.Timeout);
    expect(entry?.retryable).toBe(false);
    expect(entry?.recovery).toContain('FCC_MIRROR_ENABLED');
    // Narrowing the input does not decide whether the query completes (issue #18).
    expect(entry?.recovery).not.toContain('state filter');
  });

  it('formats empty provider list with fallback text', () => {
    const output = {
      providers: [],
      totalFound: 0,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = searchProvidersTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No providers matched the search criteria.');
  });
});
