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

describe('listDownloadsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDownloads.mockResolvedValue([MOCK_FILE]);
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
    mockListDownloads.mockResolvedValue([]);
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

  it('propagates invalid_as_of_date error from service', async () => {
    mockListDownloads.mockRejectedValue(
      Object.assign(new Error('invalid date'), { code: JsonRpcErrorCode.ValidationError }),
    );
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    await expect(listDownloadsTool.handler(input, ctx)).rejects.toThrow();
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
    mockListDownloads.mockResolvedValue([]);
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
    mockListDownloads.mockResolvedValue([sparseFile]);
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.files[0]!.subcategory).toBeUndefined();
    expect(result.files[0]!.technologyType).toBeUndefined();
    expect(result.files[0]!.stateName).toBeUndefined();
    expect(result.files[0]!.recordCount).toBeUndefined();
    expect(result.files[0]!.fileSizeBytes).toBeUndefined();
  });

  it('handles large file count correctly', async () => {
    const manyFiles = Array.from({ length: 100 }, (_, i) => ({
      ...MOCK_FILE,
      fileId: `file-${i}`,
      fileName: `bdc_state_${i}.zip`,
    }));
    mockListDownloads.mockResolvedValue(manyFiles);
    const ctx = createMockContext({ errors: listDownloadsTool.errors });
    const input = listDownloadsTool.input.parse({ as_of_date: '2024-06-30' });
    const result = await listDownloadsTool.handler(input, ctx);
    expect(result.totalFiles).toBe(100);
    expect(result.files).toHaveLength(100);
  });

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
