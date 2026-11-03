/**
 * @fileoverview Tests for the fcc_get_coverage_summary tool.
 * @module tests/tools/get-coverage-summary.tool.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('preserves an explicit satellite-inclusive filter and makes no confirmation read for actual rows', async () => {
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT]);
    mockGetGeographyName.mockResolvedValue(undefined);
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      tech_filter: 'acfosw',
    });
    expect(result.structuredContent).toMatchObject({
      techFilter: 'acfosw',
      population: { total: 100000 },
    });
    expect(JSON.stringify(result.content)).toContain('acfosw');
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaSegments.mockResolvedValue([MOCK_SEGMENT]);
    mockGetGeographyName.mockResolvedValue('Mississippi');
  });

  it('defaults to terrestrial screening on both surfaces', async () => {
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'state',
      geography_id: '28',
    });
    expect(result.structuredContent).toMatchObject({ techFilter: 'acfow' });
    expect(JSON.stringify(result.content)).toContain('acfow');
    expect(mockGetAreaSegments).toHaveBeenCalledWith(
      expect.objectContaining({ techFilter: 'acfow' }),
      expect.anything(),
    );
  });

  it.each([
    { urban_rural_filter: 'U' },
    { tribal_filter: 'T' },
    { urban_rural_filter: 'U', tribal_filter: 'T' },
  ] as const)(
    'confirms empty demographic selections without fabricating breakdown rows: %j',
    async (filters) => {
      mockGetAreaSegments.mockResolvedValueOnce([]).mockResolvedValueOnce([MOCK_SEGMENT]);
      const result = await runToolContract(getCoverageSummaryTool, {
        geography_type: 'county',
        geography_id: '28009',
        tech_filter: 'acfosw',
        speed_down: '100',
        ...filters,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        population: { total: 0, noCoverage: 0 },
        breakdown: [],
        coveragePct: 0,
        unservedPct: 0,
        competitivePct: 0,
        notice: expect.stringContaining('No population rows'),
      });
      expect(JSON.stringify(result.content)).toContain('No population rows');
      expect(JSON.stringify(result.content)).toContain('**Total Population:** 0');
      expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
      expect(mockGetAreaSegments.mock.calls[1]![0]).toEqual({
        geographyType: 'county',
        geographyId: '28009',
        techFilter: 'acfosw',
        speedDown: '100',
      });
    },
  );

  it.each(['unavailable', 'abort'] as const)(
    'propagates a failed empty-segment confirmation: %s',
    async (failure) => {
      const error =
        failure === 'abort'
          ? new DOMException('cancelled', 'AbortError')
          : new Error('unavailable');
      mockGetAreaSegments.mockResolvedValueOnce([]).mockRejectedValueOnce(error);
      const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
      const input = getCoverageSummaryTool.input.parse({
        geography_type: 'county',
        geography_id: '28009',
        urban_rural_filter: 'U',
      });
      await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toBe(error);
      expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a nonexistent filtered geography not-found even when its name resolves', async () => {
    mockGetAreaSegments.mockResolvedValue([]);
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '99999',
      tribal_filter: 'T',
    });
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'geography_not_found',
          recovery: { hint: expect.stringContaining('fcc_search_geographies') },
        },
      },
    });
    expect(JSON.stringify(result.content)).toContain('geography_not_found');
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
  });

  it('never confirms an unfiltered empty query', async () => {
    mockGetAreaSegments.mockResolvedValue([]);
    await runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '99999',
    });
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(1);
  });

  it('rethrows cancellation from optional name lookup at the handler seam', async () => {
    const error = new DOMException('cancelled', 'AbortError');
    mockGetGeographyName.mockRejectedValue(error);
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    await expect(
      getCoverageSummaryTool.handler(
        getCoverageSummaryTool.input.parse({ geography_type: 'state', geography_id: '28' }),
        ctx,
      ),
    ).rejects.toBe(error);
  });

  it('bounds both data reads by one total deadline and classifies its failure on both surfaces', async () => {
    vi.useFakeTimers();
    mockGetAreaSegments.mockResolvedValueOnce([]).mockImplementationOnce(
      (_options, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        }),
    );
    const pending = runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      tribal_filter: 'T',
    });
    await vi.advanceTimersByTimeAsync(48_000);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.Timeout,
        data: { reason: 'coverage_timeout', recovery: { hint: expect.stringContaining('retry') } },
      },
    });
    expect(JSON.stringify(result.content)).toContain('coverage_timeout');
    expect(JSON.stringify(result.content)).toContain('48');
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
  });

  it('spends the same deadline across the first read and confirmation', async () => {
    vi.useFakeTimers();
    mockGetAreaSegments
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve([]), 30_000)))
      .mockImplementationOnce(
        (_options, ctx) =>
          new Promise((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
          }),
      );
    const pending = runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      urban_rural_filter: 'U',
    });
    await vi.advanceTimersByTimeAsync(48_000);
    expect((await pending).structuredContent).toMatchObject({
      error: { data: { reason: 'coverage_timeout' } },
    });
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
  });

  it('retains successful data when only the optional name reaches the local deadline', async () => {
    vi.useFakeTimers();
    mockGetGeographyName.mockImplementation(
      (_type, _id, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        }),
    );
    const pending = runToolContract(getCoverageSummaryTool, {
      geography_type: 'state',
      geography_id: '28',
    });
    await vi.advanceTimersByTimeAsync(48_000);
    const result = await pending;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      population: { total: 100000 },
      geography: { type: 'state', id: '28' },
    });
  });

  it('completes demographic confirmation independently of an unavailable optional name', async () => {
    vi.useFakeTimers();
    mockGetAreaSegments.mockResolvedValueOnce([]).mockResolvedValueOnce([MOCK_SEGMENT]);
    mockGetGeographyName.mockImplementation(
      (_type, _id, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        }),
    );
    const pending = runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      tribal_filter: 'T',
    });
    await vi.advanceTimersByTimeAsync(48_000);
    const result = await pending;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      population: { total: 0 },
      breakdown: [],
      notice: expect.stringContaining('No population rows'),
    });
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(2);
  });

  it('propagates caller cancellation during confirmation unchanged and forwards the same signal', async () => {
    const controller = new AbortController();
    const error = new Error('caller stopped');
    mockGetAreaSegments.mockResolvedValueOnce([]).mockImplementationOnce((_options, ctx) => {
      controller.abort(error);
      expect(ctx.signal.aborted).toBe(true);
      return Promise.reject(error);
    });
    const ctx = createMockContext({
      errors: getCoverageSummaryTool.errors,
      signal: controller.signal,
    });
    const input = getCoverageSummaryTool.input.parse({
      geography_type: 'county',
      geography_id: '28009',
      tribal_filter: 'T',
    });
    await expect(getCoverageSummaryTool.handler(input, ctx)).rejects.toBe(error);
    expect(mockGetAreaSegments.mock.calls[0]![1].signal).toBe(
      mockGetAreaSegments.mock.calls[1]![1].signal,
    );
  });

  it('propagates failure on the first data read without a confirmation', async () => {
    const error = new Error('first read unavailable');
    mockGetAreaSegments.mockRejectedValueOnce(error);
    const ctx = createMockContext({ errors: getCoverageSummaryTool.errors });
    await expect(
      getCoverageSummaryTool.handler(
        getCoverageSummaryTool.input.parse({
          geography_type: 'county',
          geography_id: '28009',
          tribal_filter: 'T',
        }),
        ctx,
      ),
    ).rejects.toBe(error);
    expect(mockGetAreaSegments).toHaveBeenCalledTimes(1);
  });

  it('bounds real service retries on the confirmation read without replacing the retry path', async () => {
    vi.useFakeTimers();
    const { OpenDataService } = await vi.importActual<
      typeof import('@/services/open-data/open-data-service.js')
    >('@/services/open-data/open-data-service.js');
    const service = new OpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
    });
    mockGetAreaSegments.mockImplementation((options, ctx) => service.getAreaSegments(options, ctx));
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      const where = new URL(url).searchParams.get('$where') ?? '';
      if (where.includes("tribal_non='T'")) return Promise.resolve(Response.json([]));
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      tribal_filter: 'T',
    });
    await vi.advanceTimersByTimeAsync(48_000);
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.Timeout, data: { reason: 'coverage_timeout' } },
    });
    expect(JSON.stringify(result.content)).toContain('coverage_timeout');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves a confirmation HTTP failure through the real service status mapper on both surfaces', async () => {
    const { OpenDataService } = await vi.importActual<
      typeof import('@/services/open-data/open-data-service.js')
    >('@/services/open-data/open-data-service.js');
    const service = new OpenDataService({} as AppConfig, {} as StorageService, {
      mirrorEnabled: false,
      mirrorPath: 'unused',
    });
    mockGetAreaSegments.mockImplementation((options, ctx) => service.getAreaSegments(options, ctx));
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new URL(url).searchParams.get('$where')?.includes("tribal_non='T'")
          ? Response.json([])
          : new Response('Forbidden', { status: 403 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '28009',
      tribal_filter: 'T',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).not.toContain('geography_not_found');
    expect(JSON.stringify(result.structuredContent)).toContain('FCC Open Data');
    expect(JSON.stringify(result.content)).toContain('FCC Open Data');
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(getEnrichment(ctx)).toMatchObject({
      appliedFilters: { geographyType: 'state', geographyId: '28', speedDownMbps: 25 },
    });
  });

  it('renders zero population without NaN when the name lookup fails', async () => {
    mockGetGeographyName.mockRejectedValue(new Error('lookup unavailable'));
    mockGetAreaSegments.mockResolvedValue([
      {
        urbanRural: 'U',
        tribal: 'T',
        population: { noCoverage: 0, oneProvider: 0, twoProviders: 0, threeOrMore: 0, total: 0 },
        coveragePct: 0,
        unservedPct: 0,
        competitivePct: 0,
      },
    ]);
    const result = await runToolContract(getCoverageSummaryTool, {
      geography_type: 'county',
      geography_id: '53033',
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      geography: { type: 'county', id: '53033' },
      coveragePct: 0,
      competitivePct: 0,
      unservedPct: 0,
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain('county 53033');
    expect(text).toContain('| Urban | Tribal |');
    expect(text).not.toContain('NaN');
    expect(text).toContain('0%');
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
  ])(
    'throws invalid_geography_id_shape for geography_type="%s" with mis-shaped id "%s"',
    async (geographyType, geographyId) => {
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
    },
  );

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
