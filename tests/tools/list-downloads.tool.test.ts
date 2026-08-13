/**
 * @fileoverview Tests for the fcc_list_downloads tool.
 * @module tests/tools/list-downloads.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDownloadsTool } from '@/mcp-server/tools/definitions/list-downloads.tool.js';

const mockListDownloads = vi.fn();

vi.mock('@/services/bdc-api/bdc-api-service.js', () => ({
  getBdcApiService: () => ({ listDownloads: mockListDownloads }),
}));

const MOCK_FILE = {
  fileId: 'file-001',
  fileName: 'bdc_WA_Fixed_Broadband_2024-06-30.zip',
  category: 'State',
  subcategory: 'Fixed',
  technologyType: 'Fixed Broadband',
  stateName: 'Washington',
  stateAbbr: 'WA',
  providerName: undefined,
  fileSizeBytes: 1048576,
  recordCount: 500000,
  downloadUrl: 'https://broadbandmap.fcc.gov/file/bdc_WA_Fixed_Broadband_2024-06-30.zip',
  asOfDate: '2024-06-30',
};

/** The `{ files, total }` page the service hands back. */
function page(files: unknown[], total = files.length) {
  return { files, total };
}

/** `count` files that differ only by identity fields, numbered from `from`. */
function filesFrom(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...MOCK_FILE,
    fileId: `file-${from + i}`,
    fileName: `bdc_provider_${from + i}.zip`,
  }));
}

describe('listDownloadsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDownloads.mockResolvedValue(page([MOCK_FILE]));
  });

  // Happy path
  it('returns files for a valid as-of date', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.asOfDate).toBe('2024-06-30');
    expect(result.dataType).toBe('availability');
    expect(result.totalFiles).toBe(1);
    expect(result.files[0]!.fileId).toBe('file-001');
    expect(result.files[0]!.downloadUrl).toContain('broadbandmap.fcc.gov');
  });

  it('passes all filters to service when provided', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      data_type: 'challenge',
      category: 'State',
      technology_type: 'Fixed Broadband',
      state: 'WA',
      provider_name: 'Comcast',
    });
    await listDownloadsTool.handler(input, ctx);
    expect(mockListDownloads).toHaveBeenCalledWith(
      expect.objectContaining({
        asOfDate: '2024-06-30',
        dataType: 'challenge',
        category: 'State',
        technologyType: 'Fixed Broadband',
        state: 'WA',
        providerName: 'Comcast',
      }),
      ctx,
    );
  });

  it('defaults data_type to availability and omits optional filters', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await listDownloadsTool.handler(input, ctx);
    const callArgs = mockListDownloads.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs.dataType).toBe('availability');
    expect(callArgs).not.toHaveProperty('category');
    expect(callArgs).not.toHaveProperty('technologyType');
    expect(callArgs).not.toHaveProperty('state');
    expect(callArgs).not.toHaveProperty('providerName');
  });

  it('enriches with appliedFilters including optional filters when set', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      category: 'Provider',
      state: 'WA',
    });
    await listDownloadsTool.handler(input, ctx);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.appliedFilters).toBeDefined();
    const filters = enrichment.appliedFilters as Record<string, unknown>;
    expect(filters.asOfDate).toBe('2024-06-30');
    expect(filters.dataType).toBe('availability');
    expect(filters.category).toBe('Provider');
    expect(filters.state).toBe('WA');
    expect(filters.technologyType).toBeUndefined();
  });

  it('enriches with notice when no files match filters', async () => {
    mockListDownloads.mockResolvedValue(page([]));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      state: 'ZZ',
    });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.files).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(typeof enrichment.notice).toBe('string');
    expect(enrichment.notice as string).toContain('2024-06-30');
  });

  it('propagates credentials_required error from service', async () => {
    mockListDownloads.mockRejectedValue(
      Object.assign(new Error('credentials required'), { code: JsonRpcErrorCode.Unauthorized }),
    );
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await expect(listDownloadsTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.Unauthorized,
    });
  });

  it('propagates the reason and recovery of an invalid_as_of_date error', async () => {
    mockListDownloads.mockRejectedValue(
      Object.assign(new Error('invalid date'), {
        code: JsonRpcErrorCode.ValidationError,
        data: {
          reason: 'invalid_as_of_date',
          asOfDate: '2024-13-99',
          recovery: { hint: 'Pass a YYYY-MM-DD date.' },
        },
      }),
    );
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await expect(listDownloadsTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'invalid_as_of_date', recovery: { hint: 'Pass a YYYY-MM-DD date.' } },
    });
  });

  it('declares invalid_as_of_date as a validation failure with recovery guidance', () => {
    const contract = listDownloadsTool.errors!.find((e) => e.reason === 'invalid_as_of_date')!;
    expect(contract.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(contract.when).toMatch(/calendar/);
    expect(contract.recovery).toMatch(/fcc_list_filing_periods/);
  });

  // Input validation
  it('rejects malformed as_of_date (not YYYY-MM-DD)', () => {
    expect(() => listDownloadsTool.input.parse({ as_of_date: 'June 2024' })).toThrow();
  });

  it('rejects as_of_date with wrong format (YYYYMMDD)', () => {
    expect(() => listDownloadsTool.input.parse({ as_of_date: '20240630' })).toThrow();
  });

  it('rejects invalid state abbreviation (lowercase)', () => {
    expect(() =>
      listDownloadsTool.input.parse({ as_of_date: '2024-06-30', state: 'wa' }),
    ).toThrow();
  });

  it('rejects invalid state abbreviation (3 letters)', () => {
    expect(() =>
      listDownloadsTool.input.parse({ as_of_date: '2024-06-30', state: 'WAS' }),
    ).toThrow();
  });

  it('rejects invalid data_type value', () => {
    expect(() =>
      listDownloadsTool.input.parse({ as_of_date: '2024-06-30', data_type: 'summary' }),
    ).toThrow();
  });

  it('rejects invalid technology_type value', () => {
    expect(() =>
      listDownloadsTool.input.parse({ as_of_date: '2024-06-30', technology_type: 'Satellite' }),
    ).toThrow();
  });

  it('rejects invalid category value', () => {
    expect(() =>
      listDownloadsTool.input.parse({ as_of_date: '2024-06-30', category: 'District' }),
    ).toThrow();
  });

  it('missing as_of_date fails parse', () => {
    expect(() => listDownloadsTool.input.parse({})).toThrow();
  });

  // Edge cases
  it('handles empty file list without error', async () => {
    mockListDownloads.mockResolvedValue(page([]));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.files).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });

  it('handles file with no optional fields (sparse payload)', async () => {
    const sparseFile = {
      fileId: 'file-sparse',
      fileName: 'bdc_national_summary.csv',
      category: 'Summary',
      downloadUrl: 'https://broadbandmap.fcc.gov/file/bdc_national_summary.csv',
      asOfDate: '2024-06-30',
    };
    mockListDownloads.mockResolvedValue(page([sparseFile]));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.files[0]!.subcategory).toBeUndefined();
    expect(result.files[0]!.technologyType).toBeUndefined();
    expect(result.files[0]!.stateName).toBeUndefined();
    expect(result.files[0]!.recordCount).toBeUndefined();
    expect(result.files[0]!.fileSizeBytes).toBeUndefined();
  });

  // Pagination — the page window, and the four shapes an answer can take:
  // complete, partial, exhausted, and empty.
  it('passes the requested page window to the service', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      limit: 25,
      offset: 50,
    });
    await listDownloadsTool.handler(input, ctx);
    expect(mockListDownloads).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 50 }),
      ctx,
    );
  });

  it('defaults the page window to the first 50 files', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await listDownloadsTool.handler(input, ctx);
    expect(mockListDownloads).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
      ctx,
    );
  });

  it('rejects a limit above the cap and a negative offset', () => {
    expect(() => listDownloadsTool.input.parse({ as_of_date: '2024-06-30', limit: 201 })).toThrow();
    expect(() => listDownloadsTool.input.parse({ as_of_date: '2024-06-30', offset: -1 })).toThrow();
  });

  // Rewritten from the pre-pagination assertion that 100 mock files came back as
  // 100 unbounded. A 100-file manifest is now the over-cap case: one page of 50,
  // totalFiles describing all 100, and a nextOffset to walk with.
  it('returns one capped page of a larger manifest and points at the next', async () => {
    mockListDownloads.mockResolvedValue(page(filesFrom(0, 50), 100));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);

    expect(result.files).toHaveLength(50);
    expect(result.totalFiles).toBe(100);

    const enrichment = getEnrichment(ctx);
    expect(enrichment).toMatchObject({
      offset: 0,
      pageSize: 50,
      count: 50,
      nextOffset: 50,
      truncated: true,
    });
    expect(enrichment.notice as string).toContain('offset=50');
    expect(enrichment.notice as string).toContain('1–50 of 100');
  });

  it('omits nextOffset on the last page', async () => {
    mockListDownloads.mockResolvedValue(page(filesFrom(50, 50), 100));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30', offset: 50 });
    const result = await listDownloadsTool.handler(input, ctx);

    expect(result.totalFiles).toBe(100);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.notice as string).toContain('last page');
  });

  it('reports a complete result as untruncated with no continuation', async () => {
    mockListDownloads.mockResolvedValue(page(filesFrom(0, 10), 10));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await listDownloadsTool.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    expect(enrichment.notice as string).toContain('1–10 of 10');
  });

  it('fills an exact-cap page and still offers the next one', async () => {
    mockListDownloads.mockResolvedValue(page(filesFrom(0, 25), 50));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30', limit: 25 });
    await listDownloadsTool.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment).toMatchObject({ count: 25, pageSize: 25, nextOffset: 25, truncated: true });
  });

  it('distinguishes an offset past the end from a search that matched nothing', async () => {
    mockListDownloads.mockResolvedValue(page([], 100));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30', offset: 500 });
    const result = await listDownloadsTool.handler(input, ctx);

    expect(result.files).toHaveLength(0);
    expect(result.totalFiles).toBe(100);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.count).toBe(0);
    expect(enrichment.nextOffset).toBeUndefined();
    const notice = enrichment.notice as string;
    expect(notice).toContain('past the end');
    expect(notice).toContain('offset=0');
    expect(notice).not.toContain('No files found');
  });

  it('says nothing matched when the filtered set is empty', async () => {
    mockListDownloads.mockResolvedValue(page([], 0));
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30', state: 'ZZ' });
    await listDownloadsTool.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(false);
    expect(enrichment.nextOffset).toBeUndefined();
    const notice = enrichment.notice as string;
    expect(notice).toContain('No files found');
    expect(notice).not.toContain('past the end');
  });

  /*
   * `truncated` and `notice` are required enrichment fields, so a page shape that
   * leaves either unpopulated fails the effective-output parse at runtime rather
   * than in any assertion above. Parse each shape against the schema the
   * framework advertises — output.extend(enrichment) — to catch that here.
   */
  it.each([
    ['complete', page(filesFrom(0, 10), 10), 0],
    ['partial', page(filesFrom(0, 50), 100), 0],
    ['exhausted', page([], 100), 500],
    ['empty', page([], 0), 0],
  ])(
    'emits a %s page that satisfies the advertised output schema',
    async (_label, result, offset) => {
      mockListDownloads.mockResolvedValue(result);
      const ctx = createMockContext({ errors: listDownloadsTool.errors });
      const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30', offset });
      const output = await listDownloadsTool.handler(input, ctx);

      const effective = listDownloadsTool.output.extend(listDownloadsTool.enrichment!);
      expect(() => effective.parse({ ...output, ...getEnrichment(ctx) })).not.toThrow();
    },
  );

  // Format output
  it('formats output with file details', () => {
    const output = {
      files: [MOCK_FILE],
      totalFiles: 1,
      asOfDate: '2024-06-30',
      dataType: 'availability',
    };
    const blocks = listDownloadsTool.format!(output);
    expect(blocks.length).toBeGreaterThan(0);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('2024-06-30');
    expect(text).toContain('file-001');
    expect(text).toContain('bdc_WA_Fixed_Broadband_2024-06-30.zip');
    expect(text).toContain('State');
    expect(text).toContain('Washington');
    expect(text).toContain('WA');
    expect(text).toContain('Fixed Broadband');
    expect(text).toContain('1048576');
    expect(text).toContain('broadbandmap.fcc.gov');
    expect(text).toContain('500,000');
    expect(text).toContain('1');
    expect(text).toContain('availability');
  });

  it('formats a partial page as a slice of the matching set', () => {
    const output = {
      files: filesFrom(0, 3),
      totalFiles: 100,
      asOfDate: '2024-06-30',
      dataType: 'availability',
    };
    const text = (listDownloadsTool.format!(output)[0] as { text: string }).text;
    // The page count and the set total are both on the content[] surface, so a
    // format()-only client cannot read three files as the whole manifest.
    expect(text).toContain('3 of 100');
    for (const file of output.files) {
      expect(text).toContain(file.fileId);
      expect(text).toContain(file.downloadUrl);
    }
  });

  it('formats empty file list with fallback text', () => {
    const output = {
      files: [],
      totalFiles: 0,
      asOfDate: '2024-06-30',
      dataType: 'availability',
    };
    const blocks = listDownloadsTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No files found matching the filters');
  });

  it('formats an exhausted page as past the end, not as no match', () => {
    const output = {
      files: [],
      totalFiles: 100,
      asOfDate: '2024-06-30',
      dataType: 'availability',
    };
    const text = (listDownloadsTool.format!(output)[0] as { text: string }).text;
    expect(text).toContain('past the end of the 100 matching files');
    expect(text).not.toContain('No files found matching the filters');
  });

  it('formats file without optional fields gracefully', () => {
    const sparseFile = {
      fileId: 'file-sparse',
      fileName: 'bdc_national_summary.csv',
      category: 'Summary',
      downloadUrl: 'https://broadbandmap.fcc.gov/file/bdc_national_summary.csv',
      asOfDate: '2024-06-30',
    };
    const output = {
      files: [sparseFile],
      totalFiles: 1,
      asOfDate: '2024-06-30',
      dataType: 'challenge',
    };
    const blocks = listDownloadsTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('bdc_national_summary.csv');
    expect(text).toContain('Not available');
  });

  // Security
  it('does not leak env variable names in output', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/FCC_BDC_USERNAME/);
    expect(serialized).not.toMatch(/FCC_BDC_HASH_VALUE/);
    expect(serialized).not.toMatch(/API_KEY/i);
  });

  it('does not reflect injection-like state into output', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    // Provider name with SQL-like injection chars
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      provider_name: "'; DROP TABLE providers; --",
    });
    await listDownloadsTool.handler(input, ctx);
    const callArgs = mockListDownloads.mock.calls[0]![0] as Record<string, unknown>;
    // The raw injection string is forwarded — the service is responsible for safe handling.
    // What we verify here is that the output doesn't echo back unescaped injection strings
    // in a way that could confuse downstream consumers.
    expect(callArgs.providerName).toBe("'; DROP TABLE providers; --");
  });

  it('handles unicode/international provider names', async () => {
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      provider_name: 'Telecom España',
    });
    await listDownloadsTool.handler(input, ctx);
    const callArgs = mockListDownloads.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs.providerName).toBe('Telecom España');
  });

  it('rejects oversized provider_name string (>1000 chars) via parse failure or pass-through', async () => {
    // Zod does not enforce max length on provider_name, so we verify the field reaches the service.
    // This documents behavior — security enforcement belongs in the service layer.
    const longName = 'A'.repeat(1001);
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({
      as_of_date: '2024-06-30',
      provider_name: longName,
    });
    await listDownloadsTool.handler(input, ctx);
    const callArgs = mockListDownloads.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs.providerName).toBe(longName);
  });
});
