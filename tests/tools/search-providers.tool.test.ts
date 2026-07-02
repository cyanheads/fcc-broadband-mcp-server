/**
 * @fileoverview Tests for the fcc_search_providers tool.
 * @module tests/tools/search-providers.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchProvidersTool } from '@/mcp-server/tools/definitions/search-providers.tool.js';

const mockSearchProviders = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ searchProviders: mockSearchProviders }),
}));

const MOCK_PROVIDERS = [
  {
    hoconum: '130152',
    holdingCompanyName: 'Comcast',
    statesServed: ['WA', 'CA'],
    techCodes: ['41', '50'],
  },
];

describe('searchProvidersTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchProviders.mockResolvedValue(MOCK_PROVIDERS);
  });

  it('returns providers for a name search', async () => {
    const ctx = createMockContext();
    const input = searchProvidersTool.input.parse({ name_search: 'Comcast' });
    const result = await searchProvidersTool.handler(input, ctx);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].hoconum).toBe('130152');
    expect(result.totalFound).toBe(1);
  });

  it('returns empty result with notice in enrichment when no providers found', async () => {
    mockSearchProviders.mockResolvedValue([]);
    const ctx = createMockContext();
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

  it('omits optional params from service call when not provided', async () => {
    const ctx = createMockContext();
    const input = searchProvidersTool.input.parse({ limit: 50 });
    await searchProvidersTool.handler(input, ctx);
    const callArgs = mockSearchProviders.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('nameSearch');
    expect(callArgs).not.toHaveProperty('state');
    expect(callArgs).not.toHaveProperty('techCodes');
    expect(callArgs).toHaveProperty('limit', 50);
  });

  it('passes filters to service correctly', async () => {
    const ctx = createMockContext();
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
    expect(text).toContain('1');
  });

  it('declares the non-retryable live_search_timeout contract entry', () => {
    const entry = searchProvidersTool.errors?.find((e) => e.reason === 'live_search_timeout');
    expect(entry).toBeDefined();
    expect(entry?.code).toBe(JsonRpcErrorCode.Timeout);
    expect(entry?.retryable).toBe(false);
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
