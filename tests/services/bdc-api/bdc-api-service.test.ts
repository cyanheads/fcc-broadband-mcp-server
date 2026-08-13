/**
 * @fileoverview Tests for BdcApiService.listDownloads — the request shape it
 * sends, the order it validates in, its filtering and normalization, and the
 * page window it returns. Pins behavior the tool tests cannot see: they mock
 * `getBdcApiService()` wholesale, so nothing else exercises this method.
 * @module tests/services/bdc-api/bdc-api-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, type McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import { BdcApiService } from '@/services/bdc-api/bdc-api-service.js';
import type { BdcDownloadFile } from '@/services/bdc-api/types.js';

const WITH_CREDENTIALS: ServerConfig = {
  bdcUsername: 'analyst@example.test',
  bdcHashValue: 'test-hash-value',
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

const WITHOUT_CREDENTIALS: ServerConfig = {
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

/** A published BDC as-of date, used wherever the date itself is not under test. */
const PUBLISHED_DATE = '2024-06-30';

function makeService(serverConfig: ServerConfig = WITH_CREDENTIALS): BdcApiService {
  return new BdcApiService({} as AppConfig, {} as StorageService, serverConfig);
}

/** Wraps a payload in the BDC envelope shape and hands it back as a fetch Response. */
function bdcResponse(data: unknown): { ok: boolean; text: () => Promise<string> } {
  return {
    ok: true,
    text: () => Promise.resolve(JSON.stringify({ data, status: 'successful', status_code: 200 })),
  };
}

/** The set /listAsOfDates answers with unless a test overrides it. */
const PUBLISHED_AS_OF_DATES = [
  '2022-06-30',
  '2022-12-31',
  '2023-06-30',
  '2023-12-31',
  '2024-06-30',
];

/**
 * Stubs global fetch, routing by URL: /listAsOfDates answers with the published
 * date set, every download manifest URL answers with `files`.
 */
function stubBdc(files: BdcDownloadFile[], asOfDates: string[] = PUBLISHED_AS_OF_DATES) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(
      String(url).endsWith('/listAsOfDates') ? bdcResponse(asOfDates) : bdcResponse(files),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** URLs the fetch stub was called with, in order. */
function calledUrls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** The `recovery.hint` an McpError carries on the wire. */
function recoveryHint(error: McpError): string {
  return (error.data as { recovery: { hint: string } }).recovery.hint;
}

const WA_FIXED: BdcDownloadFile = {
  file_id: 'file-wa',
  file_name: 'bdc_53_Cable_fixed_broadband_J24.zip',
  category: 'State',
  subcategory: 'Fixed',
  technology_type: 'Fixed Broadband',
  state_abbr: 'WA',
  state_name: 'Washington',
  provider_name: 'Comcast',
  file_size: 1_048_576,
  record_count: 500_000,
  download_url: 'https://broadbandmap.fcc.gov/file/bdc_53_Cable_fixed_broadband_J24.zip',
  as_of_date: PUBLISHED_DATE,
};

const NATIONAL_SUMMARY: BdcDownloadFile = {
  file_id: 'file-national',
  file_name: 'bdc_us_summary_J24.csv',
  category: 'Summary',
  technology_type: 'Mobile Broadband',
  download_url: 'https://broadbandmap.fcc.gov/file/bdc_us_summary_J24.csv',
  as_of_date: PUBLISHED_DATE,
};

/** A window wide enough to hold every fixture, for tests not about paging. */
const WHOLE_SET = { limit: 200, offset: 0 } as const;

describe('BdcApiService.listDownloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('request shape', () => {
    it('reads the availability manifest for the requested as-of date', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET },
        ctx,
      );

      expect(calledUrls(fetchMock)).toContain(
        `https://bdc.fcc.gov/api/public/map/downloads/listAvailabilityData/${PUBLISHED_DATE}`,
      );
    });

    it('reads the challenge manifest when dataType is challenge', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'challenge', ...WHOLE_SET },
        ctx,
      );

      expect(calledUrls(fetchMock)).toContain(
        `https://bdc.fcc.gov/api/public/map/downloads/listChallengeData/${PUBLISHED_DATE}`,
      );
    });

    it('sends the credentials as username and hash_value headers', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET },
        ctx,
      );

      const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
      expect(init.headers).toEqual({
        username: 'analyst@example.test',
        hash_value: 'test-hash-value',
      });
    });
  });

  describe('filtering', () => {
    it('filters by category, case-insensitively and exactly', async () => {
      stubBdc([WA_FIXED, NATIONAL_SUMMARY]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', category: 'summary', ...WHOLE_SET },
        ctx,
      );

      expect(page.files.map((f) => f.fileId)).toEqual(['file-national']);
    });

    it('filters by technology type as a substring match', async () => {
      stubBdc([WA_FIXED, NATIONAL_SUMMARY]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        {
          asOfDate: PUBLISHED_DATE,
          dataType: 'availability',
          technologyType: 'Mobile',
          ...WHOLE_SET,
        },
        ctx,
      );

      expect(page.files.map((f) => f.fileId)).toEqual(['file-national']);
    });

    it('filters by state abbreviation, case-insensitively', async () => {
      stubBdc([WA_FIXED, NATIONAL_SUMMARY]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', state: 'wa', ...WHOLE_SET },
        ctx,
      );

      expect(page.files.map((f) => f.fileId)).toEqual(['file-wa']);
    });

    it('filters by provider name as a substring match', async () => {
      stubBdc([WA_FIXED, NATIONAL_SUMMARY]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        {
          asOfDate: PUBLISHED_DATE,
          dataType: 'availability',
          providerName: 'comcast',
          ...WHOLE_SET,
        },
        ctx,
      );

      expect(page.files.map((f) => f.fileId)).toEqual(['file-wa']);
    });
  });

  describe('normalization', () => {
    it('maps the upstream field names onto the normalized shape', async () => {
      stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET },
        ctx,
      );

      expect(page.files[0]).toEqual({
        fileId: 'file-wa',
        fileName: 'bdc_53_Cable_fixed_broadband_J24.zip',
        category: 'State',
        subcategory: 'Fixed',
        technologyType: 'Fixed Broadband',
        stateName: 'Washington',
        stateAbbr: 'WA',
        providerName: 'Comcast',
        fileSizeBytes: 1_048_576,
        recordCount: 500_000,
        downloadUrl: 'https://broadbandmap.fcc.gov/file/bdc_53_Cable_fixed_broadband_J24.zip',
        asOfDate: PUBLISHED_DATE,
      });
    });

    it('omits optional fields a sparse upstream payload leaves out', async () => {
      stubBdc([
        {
          id: 'legacy-id',
          name: 'bdc_sparse.csv',
          url: 'https://broadbandmap.fcc.gov/file/bdc_sparse.csv',
        },
      ]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET },
        ctx,
      );

      // id/name/url are the alternate upstream spellings; the as-of date falls
      // back to the one queried when the row omits it.
      expect(page.files[0]).toEqual({
        fileId: 'legacy-id',
        fileName: 'bdc_sparse.csv',
        category: '',
        downloadUrl: 'https://broadbandmap.fcc.gov/file/bdc_sparse.csv',
        asOfDate: PUBLISHED_DATE,
      });
    });
  });

  describe('credentials', () => {
    it('reports credentials_required when neither credential is configured', async () => {
      stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService(WITHOUT_CREDENTIALS)
        .listDownloads({ asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET }, ctx)
        .catch((e: unknown) => e)) as McpError;

      expect(error.code).toBe(JsonRpcErrorCode.Unauthorized);
      expect(error.data?.reason).toBe('credentials_required');
    });

    it('makes no upstream request when credentials are missing', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      await makeService(WITHOUT_CREDENTIALS)
        .listDownloads({ asOfDate: PUBLISHED_DATE, dataType: 'availability', ...WHOLE_SET }, ctx)
        .catch(() => undefined);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  /*
   * Two failure classes, separated by what it takes to detect them. A date that
   * is not a real calendar date, or that falls before BDC began, is wrong on its
   * face and is rejected with no credentials and no network. Membership in the
   * published set is only knowable from the credentialed /listAsOfDates endpoint,
   * so it is checked after the credentials gate.
   */
  describe('as-of date validation without credentials', () => {
    it.each([
      ['a month past 12', '2024-13-99'],
      ['a day past the end of the month', '2024-02-30'],
      ['a zero month', '2024-00-15'],
    ])('rejects %s as invalid_as_of_date', async (_label, asOfDate) => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService(WITHOUT_CREDENTIALS)
        .listDownloads({ asOfDate, dataType: 'availability', limit: 50, offset: 0 }, ctx)
        .catch((e: unknown) => e)) as McpError;

      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_as_of_date');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed date shape', async () => {
      stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService(WITHOUT_CREDENTIALS)
        .listDownloads(
          { asOfDate: 'June 2024', dataType: 'availability', limit: 50, offset: 0 },
          ctx,
        )
        .catch((e: unknown) => e)) as McpError;

      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_as_of_date');
    });

    it('rejects a date before the first BDC filing period and names the Form 477 era', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService(WITHOUT_CREDENTIALS)
        .listDownloads(
          { asOfDate: '2021-06-30', dataType: 'availability', limit: 50, offset: 0 },
          ctx,
        )
        .catch((e: unknown) => e)) as McpError;

      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_as_of_date');
      expect(error.message).toContain('2022-06-30');
      expect(recoveryHint(error)).toMatch(/Form 477/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('carries a recovery hint that separates a bad date from a missing credential', async () => {
      stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService(WITHOUT_CREDENTIALS)
        .listDownloads(
          { asOfDate: '2024-13-99', dataType: 'availability', limit: 50, offset: 0 },
          ctx,
        )
        .catch((e: unknown) => e)) as McpError;

      const hint = recoveryHint(error);
      expect(hint).toMatch(/calendar date/i);
      expect(hint).not.toMatch(/FCC_BDC_USERNAME/);
    });
  });

  describe('as-of date membership', () => {
    it('rejects a well-formed date the BDC API does not publish', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService()
        .listDownloads(
          { asOfDate: '2024-03-15', dataType: 'availability', limit: 50, offset: 0 },
          ctx,
        )
        .catch((e: unknown) => e)) as McpError;

      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_as_of_date');
      // The published set was consulted; the manifest was never requested.
      expect(calledUrls(fetchMock)).toEqual(['https://bdc.fcc.gov/api/public/map/listAsOfDates']);
    });

    it('names published dates in the error so the caller can pick one', async () => {
      stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const error = (await makeService()
        .listDownloads(
          { asOfDate: '2024-03-15', dataType: 'availability', limit: 50, offset: 0 },
          ctx,
        )
        .catch((e: unknown) => e)) as McpError;

      expect(recoveryHint(error)).toContain('2024-06-30');
    });

    it('accepts a published date and reads the manifest', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 50, offset: 0 },
        ctx,
      );

      expect(page.files).toHaveLength(1);
      expect(calledUrls(fetchMock)).toContain(
        `https://bdc.fcc.gov/api/public/map/downloads/listAvailabilityData/${PUBLISHED_DATE}`,
      );
    });

    it('reads the published set once and reuses it across calls', async () => {
      const fetchMock = stubBdc([WA_FIXED]);
      const ctx = createMockContext();
      const service = makeService();

      await service.listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 50, offset: 0 },
        ctx,
      );
      await service.listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 50, offset: 50 },
        ctx,
      );

      const asOfDateCalls = calledUrls(fetchMock).filter((url) => url.endsWith('/listAsOfDates'));
      expect(asOfDateCalls).toHaveLength(1);
    });

    it('accepts the object form of the published set', async () => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/listAsOfDates')
            ? bdcResponse([{ as_of_date: PUBLISHED_DATE, publication_date: '2024-11-15' }])
            : bdcResponse([WA_FIXED]),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 50, offset: 0 },
        ctx,
      );

      expect(page.files).toHaveLength(1);
    });
  });

  describe('page window', () => {
    /** 100 provider files, differing only by identity fields. */
    const manyFiles = Array.from({ length: 100 }, (_, i) => ({
      ...WA_FIXED,
      file_id: `file-${i}`,
      file_name: `bdc_provider_${i}.zip`,
    }));

    it('returns one page and the complete filtered total', async () => {
      stubBdc(manyFiles);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 25, offset: 0 },
        ctx,
      );

      expect(page.files).toHaveLength(25);
      expect(page.total).toBe(100);
      expect(page.files[0]!.fileId).toBe('file-0');
    });

    it('reads the window starting at the offset', async () => {
      stubBdc(manyFiles);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 25, offset: 25 },
        ctx,
      );

      expect(page.files[0]!.fileId).toBe('file-25');
      expect(page.files.at(-1)!.fileId).toBe('file-49');
    });

    it('returns a short last page rather than padding it', async () => {
      stubBdc(manyFiles);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 30, offset: 90 },
        ctx,
      );

      expect(page.files).toHaveLength(10);
      expect(page.total).toBe(100);
    });

    it('returns an empty page past the end while still reporting the total', async () => {
      stubBdc(manyFiles);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        { asOfDate: PUBLISHED_DATE, dataType: 'availability', limit: 25, offset: 500 },
        ctx,
      );

      expect(page.files).toHaveLength(0);
      expect(page.total).toBe(100);
    });

    it('counts the filtered set, not the whole manifest', async () => {
      stubBdc([...manyFiles, NATIONAL_SUMMARY]);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        {
          asOfDate: PUBLISHED_DATE,
          dataType: 'availability',
          category: 'Summary',
          limit: 25,
          offset: 0,
        },
        ctx,
      );

      expect(page.total).toBe(1);
      expect(page.files.map((f) => f.fileId)).toEqual(['file-national']);
    });

    it('reports a zero total when nothing matches the filters', async () => {
      stubBdc(manyFiles);
      const ctx = createMockContext();

      const page = await makeService().listDownloads(
        {
          asOfDate: PUBLISHED_DATE,
          dataType: 'availability',
          state: 'ZZ',
          limit: 25,
          offset: 0,
        },
        ctx,
      );

      expect(page.files).toHaveLength(0);
      expect(page.total).toBe(0);
    });
  });
});
