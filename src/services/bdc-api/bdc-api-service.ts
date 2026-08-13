/**
 * @fileoverview FCC BDC Public Data API service — wraps bdc.fcc.gov/api/public/map/.
 * Provides access to BDC filing dates and bulk download manifests (post-2022 data).
 * Requires FCC account credentials via FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE env vars.
 * @module services/bdc-api/bdc-api-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable, unauthorized, validationError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import {
  BDC_FIRST_AS_OF_DATE,
  type BdcApiEnvelope,
  type BdcAsOfDate,
  type BdcDownloadFile,
  type DownloadFile,
  type FilingPeriod,
  FORM477_PERIODS,
} from './types.js';

const BASE_URL = 'https://bdc.fcc.gov/api/public/map';
const TIMEOUT_MS = 30_000;

/**
 * How long a fetched as-of-date set stays usable. BDC publishes a new as-of date
 * twice a year, so any short window is generous; the point is to keep the
 * membership check from doubling every `listDownloads` call against the API's
 * 10-calls-per-minute budget. Nothing about the set is tenant-specific — the
 * credentials are process-wide environment variables — so one memo per service
 * instance serves every caller.
 */
const AS_OF_DATES_TTL_MS = 60 * 60 * 1000;

/** How many published dates an `invalid_as_of_date` message names back. */
const SUGGESTED_DATE_COUNT = 6;

/** True when the string names a date the calendar actually has. */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Rejects an as-of date that is wrong on its face — a string the calendar has no
 * day for, or one earlier than BDC itself. Both are answerable from the string
 * alone, which is why this runs ahead of the credentials gate: a deployment with
 * no BDC account still learns its date is malformed instead of being told it
 * needs credentials to find out. Membership in the published set is a separate,
 * credentialed check.
 */
function assertWellFormedAsOfDate(asOfDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !isRealCalendarDate(asOfDate)) {
    throw validationError(
      `Invalid as_of_date "${asOfDate}" — not a date on the calendar. Expected YYYY-MM-DD (e.g., "${BDC_FIRST_AS_OF_DATE}").`,
      {
        reason: 'invalid_as_of_date',
        asOfDate,
        recovery: {
          hint: `"${asOfDate}" is not a real calendar date. Pass a YYYY-MM-DD date, or call fcc_list_filing_periods with include_bdc=true to read the dates BDC publishes.`,
        },
      },
    );
  }

  if (asOfDate < BDC_FIRST_AS_OF_DATE) {
    throw validationError(
      `as_of_date "${asOfDate}" is earlier than the first Broadband Data Collection period, ${BDC_FIRST_AS_OF_DATE}.`,
      {
        reason: 'invalid_as_of_date',
        asOfDate,
        recovery: {
          hint: `Dates before ${BDC_FIRST_AS_OF_DATE} are Form 477 filing periods, which have no BDC download manifest — query them with fcc_search_availability or fcc_get_coverage_summary instead. For BDC dates, call fcc_list_filing_periods with include_bdc=true.`,
        },
      },
    );
  }
}

export class BdcApiService {
  /** Memoized `/listAsOfDates` answer backing the as-of date membership check. */
  private _asOfDates: { dates: string[]; expiresAt: number } | undefined;

  constructor(
    readonly config: AppConfig,
    readonly storage: StorageService,
    private readonly _serverConfig: ServerConfig,
  ) {}

  private get hasCredentials(): boolean {
    return !!(this._serverConfig.bdcUsername && this._serverConfig.bdcHashValue);
  }

  private requireCredentials(): void {
    if (!this.hasCredentials) {
      throw unauthorized(
        'BDC API credentials not configured. Set FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE ' +
          'from the broadbandmap.fcc.gov "Manage API Access" page.',
        {
          reason: 'credentials_required',
          recovery: {
            hint: 'Set FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE environment variables from broadbandmap.fcc.gov "Manage API Access" page.',
          },
        },
      );
    }
  }

  private getAuthHeaders(): Record<string, string> {
    // requireCredentials() guards this path — values are guaranteed non-nullish here
    return {
      username: this._serverConfig.bdcUsername ?? '',
      hash_value: this._serverConfig.bdcHashValue ?? '',
    };
  }

  private fetchBdc<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const signal = ctx.signal
          ? AbortSignal.any([ctx.signal, controller.signal])
          : controller.signal;

        let response: Response;
        try {
          response = await fetch(url, { signal, headers: this.getAuthHeaders() });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'FCC BDC API' });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'BDC API returned HTML — likely rate-limited or temporarily unavailable.',
          );
        }
        const envelope: BdcApiEnvelope<T> = JSON.parse(text) as BdcApiEnvelope<T>;
        if (envelope.status !== 'successful' && envelope.status_code !== 200) {
          throw serviceUnavailable(`BDC API error: ${envelope.message ?? envelope.status}`, {
            statusCode: envelope.status_code,
          });
        }
        return envelope.data;
      },
      {
        operation: 'BdcApiService.fetchBdc',
        baseDelayMs: 2000, // BDC rate limit: 10 calls/min
        signal: ctx.signal,
      },
    );
  }

  /** Reads the as-of dates the BDC API publishes. Requires credentials. */
  private fetchAsOfDates(ctx: Context): Promise<BdcAsOfDate[] | string[]> {
    return this.fetchBdc<BdcAsOfDate[] | string[]>(`${BASE_URL}/listAsOfDates`, ctx);
  }

  /**
   * The as-of dates BDC publishes, memoized for {@link AS_OF_DATES_TTL_MS}. The
   * credentialed `/listAsOfDates` endpoint is the only source for them, so this
   * is the one date check that cannot run ahead of the credentials gate.
   */
  private async publishedAsOfDates(ctx: Context): Promise<string[]> {
    const now = Date.now();
    if (this._asOfDates && this._asOfDates.expiresAt > now) {
      return this._asOfDates.dates;
    }

    const raw = await this.fetchAsOfDates(ctx);
    const dates = raw.map((d) => (typeof d === 'string' ? d : d.as_of_date));
    this._asOfDates = { dates, expiresAt: now + AS_OF_DATES_TTL_MS };
    return dates;
  }

  /**
   * Returns available filing periods. Always includes hardcoded Form 477 periods.
   */
  async listFilingPeriods(options: { includeBdc: boolean }, ctx: Context): Promise<FilingPeriod[]> {
    const periods: FilingPeriod[] = [...FORM477_PERIODS];

    if (!options.includeBdc || !this.hasCredentials) {
      return periods;
    }

    const bdcDates = await this.fetchAsOfDates(ctx);

    const bdcPeriods: FilingPeriod[] = bdcDates.map((d) => {
      if (typeof d === 'string') {
        return { asOfDate: d, source: 'bdc' as const };
      }
      return {
        asOfDate: d.as_of_date,
        source: 'bdc' as const,
        ...(d.publication_date && { publicationDate: d.publication_date }),
      };
    });

    return [...periods, ...bdcPeriods];
  }

  /**
   * Lists one page of the downloadable BDC files for a specific as-of date.
   *
   * Validation runs in two stages, split by what it takes to detect each class
   * of wrong date: {@link assertWellFormedAsOfDate} needs nothing but the string
   * and so runs before the credentials gate, while membership in the published
   * set is only knowable from the credentialed endpoint and runs after it.
   */
  async listDownloads(
    options: {
      asOfDate: string;
      dataType: 'availability' | 'challenge';
      category?: string;
      technologyType?: string;
      state?: string;
      providerName?: string;
      limit: number;
      offset: number;
    },
    ctx: Context,
  ): Promise<{ files: DownloadFile[]; total: number }> {
    assertWellFormedAsOfDate(options.asOfDate);
    this.requireCredentials();

    const published = await this.publishedAsOfDates(ctx);
    if (!published.includes(options.asOfDate)) {
      const recent = [...published]
        .sort((a, b) => b.localeCompare(a))
        .slice(0, SUGGESTED_DATE_COUNT);
      throw validationError(
        `as_of_date "${options.asOfDate}" is not one of the ${published.length} as-of dates the BDC API publishes.`,
        {
          reason: 'invalid_as_of_date',
          asOfDate: options.asOfDate,
          recovery: {
            hint: `Published BDC as-of dates include ${recent.join(', ')}. Call fcc_list_filing_periods with include_bdc=true for the full set.`,
          },
        },
      );
    }

    const endpoint =
      options.dataType === 'availability'
        ? `/downloads/listAvailabilityData/${options.asOfDate}`
        : `/downloads/listChallengeData/${options.asOfDate}`;

    const url = `${BASE_URL}${endpoint}`;
    const files = await this.fetchBdc<BdcDownloadFile[]>(url, ctx);

    let filtered = files;

    if (options.category) {
      const cat = options.category;
      filtered = filtered.filter((f) => f.category?.toLowerCase() === cat.toLowerCase());
    }
    if (options.technologyType) {
      const tech = options.technologyType;
      filtered = filtered.filter((f) =>
        f.technology_type?.toLowerCase().includes(tech.toLowerCase()),
      );
    }
    if (options.state) {
      const st = options.state;
      filtered = filtered.filter((f) => f.state_abbr?.toUpperCase() === st.toUpperCase());
    }
    if (options.providerName) {
      const search = options.providerName.toLowerCase();
      filtered = filtered.filter((f) => f.provider_name?.toLowerCase().includes(search));
    }

    /*
     * The window is cut here, over the manifest the one upstream call already
     * returned. Whether the BDC download endpoints accept paging parameters of
     * their own is not established — the response envelope carries result_count
     * but no cursor or offset field, and the Public Data API specification is not
     * publicly retrievable — so nothing here assumes upstream paging. If it turns
     * out to exist, the page window moves into the request and `total` comes off
     * result_count; callers see the same shape either way.
     */
    const page = filtered.slice(options.offset, options.offset + options.limit);

    return {
      files: page.map((f) => ({
        fileId: f.file_id ?? f.id ?? '',
        fileName: f.file_name ?? f.name ?? '',
        category: f.category ?? '',
        ...(f.subcategory && { subcategory: f.subcategory }),
        ...(f.technology_type && { technologyType: f.technology_type }),
        ...(f.state_name && { stateName: f.state_name }),
        ...(f.state_abbr && { stateAbbr: f.state_abbr }),
        ...(f.provider_name && { providerName: f.provider_name }),
        ...(f.file_size !== undefined && { fileSizeBytes: f.file_size }),
        ...(f.record_count !== undefined && { recordCount: f.record_count }),
        downloadUrl: f.download_url ?? f.url ?? '',
        asOfDate: f.as_of_date ?? options.asOfDate,
      })),
      total: filtered.length,
    };
  }
}

// --- Init/accessor pattern ---

let _service: BdcApiService | undefined;

export function initBdcApiService(
  config: AppConfig,
  storage: StorageService,
  serverConfig: ServerConfig,
): void {
  _service = new BdcApiService(config, storage, serverConfig);
}

export function getBdcApiService(): BdcApiService {
  if (!_service) {
    throw new Error('BdcApiService not initialized — call initBdcApiService() in setup()');
  }
  return _service;
}
