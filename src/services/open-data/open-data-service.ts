/**
 * @fileoverview FCC Open Data (Socrata) service — wraps opendata.fcc.gov for Form 477 data.
 * Provides access to block-level deployment, area coverage summaries, and provider data.
 * All Form 477 data is as of June 2021 (the last filing period before BDC replaced it).
 * @module services/open-data/open-data-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import { Form477Mirror } from './mirror/form477-mirror.js';
import { MAX_SCAN_ROWS } from './mirror/stores.js';
import {
  type AreaScanResult,
  type AreaSegment,
  DATASET_IDS,
  type DeploymentRecord,
  type ProviderRecord,
  type RawAreaRow,
  type RawDeploymentRow,
  type RawGeographyRow,
  type RawProviderRow,
  type RawProviderSummaryRow,
} from './types.js';

const BASE_URL = 'https://opendata.fcc.gov/resource';
const TIMEOUT_MS = 30_000;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 50000;

/**
 * Raw Area Table rows one type-wide scan may read before grouping. Bound to the
 * mirror's per-store ceiling so both serving paths stop at the same number: the
 * mirror store rejects any query above it outright, and the live pager stops
 * there. Sized against the June 2021 Form 477 snapshot, whose broadest
 * type-wide scan — `place`, `tech='acfosw'`, one speed tier, no urban/rural
 * filter — is 43,223 rows; the snapshot is frozen, so that headroom is fixed.
 * A scan that does reach the ceiling comes back `scanTruncated: true` rather
 * than as a silent prefix.
 */
const MAX_AREA_SCAN_ROWS = MAX_SCAN_ROWS;

/** Accumulates area table rows into a per-id stats map. */
function accumulateAreaRows(rows: RawAreaRow[]): Map<
  string,
  {
    id: string;
    noCoverage: number;
    oneProvider: number;
    twoProviders: number;
    threeOrMore: number;
    total: number;
  }
> {
  const byId = new Map<
    string,
    {
      id: string;
      noCoverage: number;
      oneProvider: number;
      twoProviders: number;
      threeOrMore: number;
      total: number;
    }
  >();
  for (const r of rows) {
    const id = r.id ?? '';
    let entry = byId.get(id);
    if (!entry) {
      entry = { id, noCoverage: 0, oneProvider: 0, twoProviders: 0, threeOrMore: 0, total: 0 };
      byId.set(id, entry);
    }
    const n0 = parseInt(r.has_0 ?? '0', 10);
    const n1 = parseInt(r.has_1 ?? '0', 10);
    const n2 = parseInt(r.has_2 ?? '0', 10);
    const n3 = parseInt(r.has_3more ?? '0', 10);
    entry.noCoverage += n0;
    entry.oneProvider += n1;
    entry.twoProviders += n2;
    entry.threeOrMore += n3;
    entry.total += n0 + n1 + n2 + n3;
  }
  return byId;
}

/** Sums the d_1..d_8 speed-tier location counts across provider summary rows. */
function sumSpeedTiers(rows: RawProviderSummaryRow[]): Record<string, number> {
  const tierTotals: Record<string, number> = {};
  for (const row of rows) {
    for (const tier of ['d_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8'] as const) {
      const val = parseInt(row[tier] ?? '0', 10);
      tierTotals[tier] = (tierTotals[tier] ?? 0) + val;
    }
  }
  return tierTotals;
}

/** Query parameters for a Socrata SoQL request. */
interface SoqlParams {
  $group?: string;
  $limit?: number;
  $offset?: number;
  $order?: string;
  $select?: string;
  $where?: string;
  [key: string]: string | number | boolean | undefined;
}

export class OpenDataService {
  constructor(
    readonly config: AppConfig,
    readonly storage: StorageService,
    private readonly _serverConfig: ServerConfig,
    /**
     * Optional local Form 477 mirror (FCC_MIRROR_ENABLED). Each mirror method
     * returns `undefined` when its coverage gate cannot authoritatively serve
     * the request, in which case the live Socrata path runs unchanged.
     */
    private readonly _mirror?: Form477Mirror,
  ) {}

  /**
   * Run one mirror read. `undefined` — mirror disabled, coverage gate declined,
   * or the mirror layer failed — means the caller serves live; any other value
   * (including `null`) is authoritative. A mirror failure must degrade to the
   * live API, never fail the tool, so errors are logged and swallowed here.
   */
  private async fromMirror<T>(
    ctx: Context,
    dataset: string,
    read: (mirror: Form477Mirror) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    if (!this._mirror) return;
    try {
      const result = await read(this._mirror);
      if (result !== undefined) {
        ctx.log.debug('Served from local Form 477 mirror', { dataset });
      }
      return result;
    } catch (error) {
      ctx.log.warning('Form 477 mirror read failed — serving live', {
        dataset,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  private buildUrl(datasetId: string, params: SoqlParams): string {
    const url = new URL(`${BASE_URL}/${datasetId}.json`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    if (this._serverConfig.opendataAppToken) {
      url.searchParams.set('$$app_token', this._serverConfig.opendataAppToken);
    }
    return url.toString();
  }

  /**
   * Fetches and parses one Socrata JSON response with a 30s deadline and retry.
   *
   * A deadline abort is classified into an `McpError(Timeout)` at this choke
   * point — the raw `AbortError` thrown by fetch is a non-`McpError`, which
   * `withRetry`'s default predicate always treats as transient. By default the
   * classified error keeps the transient `Timeout` code (retries preserved for
   * cheap point queries hitting a Socrata hiccup); callers running known
   * load-bound queries pass `timeoutError` to fail fast with
   * `data.retryable: false` and an actionable recovery hint.
   */
  private fetchJson<T>(
    url: string,
    ctx: Context,
    opts?: { timeoutError?: () => McpError },
  ): Promise<T[]> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const signal = ctx.signal
          ? AbortSignal.any([ctx.signal, controller.signal])
          : controller.signal;

        let response: Response;
        try {
          response = await fetch(url, { signal });
        } catch (error) {
          // Deadline abort (our controller, not client cancellation) — classify.
          if (controller.signal.aborted && !ctx.signal?.aborted) {
            throw (
              opts?.timeoutError?.() ??
              new McpError(
                JsonRpcErrorCode.Timeout,
                `FCC Open Data request timed out after ${TIMEOUT_MS / 1000}s.`,
                undefined,
                { cause: error },
              )
            );
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'FCC Open Data' });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'FCC Open Data returned HTML — likely rate-limited or temporarily unavailable.',
          );
        }
        return JSON.parse(text) as T[];
      },
      {
        operation: 'OpenDataService.fetchJson',
        baseDelayMs: 1500,
        signal: ctx.signal,
      },
    );
  }

  /**
   * Fetches pages of a SoQL query up to `maxRows` rows. `truncated` is true
   * when the pager stopped at the cap without ever reading a short page — that
   * is, without confirming it reached the end of the match — so a caller that
   * aggregates or counts these rows can disclose the partial scan instead of
   * treating the prefix as complete.
   */
  private async fetchPagesUpTo<T>(
    datasetId: string,
    params: SoqlParams,
    ctx: Context,
    maxRows: number,
  ): Promise<{ rows: T[]; truncated: boolean }> {
    const results: T[] = [];
    let offset = 0;
    const limit = Math.min(params.$limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    let reachedEnd = false;

    while (results.length < maxRows) {
      const url = this.buildUrl(datasetId, { ...params, $limit: limit, $offset: offset });
      const page = await this.fetchJson<T>(url, ctx);
      results.push(...page);
      if (page.length < limit) {
        reachedEnd = true;
        break;
      }
      offset += limit;
    }

    return { rows: results.slice(0, maxRows), truncated: !reachedEnd };
  }

  /**
   * Fetches all pages of results for a SoQL query, up to `maxRows` rows.
   * Callers that must distinguish a complete read from a capped one use
   * `fetchPagesUpTo` instead.
   */
  private async fetchAllPages<T>(
    datasetId: string,
    params: SoqlParams,
    ctx: Context,
    maxRows = MAX_LIMIT,
  ): Promise<T[]> {
    const { rows } = await this.fetchPagesUpTo<T>(datasetId, params, ctx, maxRows);
    return rows;
  }

  /**
   * Fetches deployment records for a specific census block.
   */
  async getDeploymentByBlock(
    blockFips: string,
    options: {
      techCodes?: string[];
      minSpeedDown?: number;
      consumer?: boolean;
    },
    ctx: Context,
  ): Promise<DeploymentRecord[]> {
    let rows = await this.fromMirror(ctx, 'deployment', (m) =>
      m.deploymentByBlock(blockFips, options),
    );
    if (!rows) {
      const conditions: string[] = [`blockcode='${blockFips}'`];
      if (options.techCodes?.length) {
        const techList = options.techCodes.map((t) => `'${t}'`).join(',');
        conditions.push(`techcode IN (${techList})`);
      }
      if (options.minSpeedDown !== undefined) {
        conditions.push(`maxaddown>=${options.minSpeedDown}`);
      }
      if (options.consumer === true) {
        conditions.push(`consumer='1'`);
      } else if (options.consumer === false) {
        conditions.push(`business='1'`);
      }

      rows = await this.fetchAllPages<RawDeploymentRow>(
        DATASET_IDS.DEPLOYMENT,
        {
          $where: conditions.join(' AND '),
          $limit: DEFAULT_LIMIT,
        },
        ctx,
      );
    }

    if (rows.length === 0) {
      return [];
    }

    return rows.map((r) => ({
      blockFips: r.blockcode ?? blockFips,
      providerId: r.provider_id ?? '',
      providerName: r.providername ?? '',
      holdingCompanyName: r.holdingcompanyname ?? '',
      hoconum: r.hoconum ?? '',
      stateAbbr: r.stateabbr ?? '',
      techCode: r.techcode ?? '',
      maxDownloadMbps: parseFloat(r.maxaddown ?? '0'),
      maxUploadMbps: parseFloat(r.maxadup ?? '0'),
      consumer: r.consumer === '1',
      business: r.business === '1',
    }));
  }

  /**
   * Fetches area table rows for a geography and aggregates them into segments.
   */
  async getAreaSegments(
    options: {
      geographyType: string;
      geographyId?: string;
      techFilter: string;
      speedDown: string;
      urbanRuralFilter?: 'all' | 'R' | 'U';
      tribalFilter?: 'all' | 'T' | 'N';
    },
    ctx: Context,
  ): Promise<AreaSegment[]> {
    const geographyId = options.geographyType === 'nation' ? '0' : (options.geographyId ?? '');

    let rows = await this.fromMirror(ctx, 'area', (m) =>
      m.areaSegments({ ...options, geographyId }),
    );
    if (!rows) {
      const conditions: string[] = [
        `type='${options.geographyType}'`,
        `id='${geographyId}'`,
        `tech='${options.techFilter}'`,
        `speed='${options.speedDown}'`,
      ];

      if (options.urbanRuralFilter && options.urbanRuralFilter !== 'all') {
        conditions.push(`urban_rural='${options.urbanRuralFilter}'`);
      }
      if (options.tribalFilter && options.tribalFilter !== 'all') {
        conditions.push(`tribal_non='${options.tribalFilter}'`);
      }

      rows = await this.fetchAllPages<RawAreaRow>(
        DATASET_IDS.AREA_TABLE,
        {
          $where: conditions.join(' AND '),
          $limit: 100,
        },
        ctx,
      );
    }

    if (rows.length === 0) {
      return [];
    }

    return rows.map((r) => {
      const noCoverage = parseInt(r.has_0 ?? '0', 10);
      const oneProvider = parseInt(r.has_1 ?? '0', 10);
      const twoProviders = parseInt(r.has_2 ?? '0', 10);
      const threeOrMore = parseInt(r.has_3more ?? '0', 10);
      const total = noCoverage + oneProvider + twoProviders + threeOrMore;
      const covered = total - noCoverage;
      const competitive = twoProviders + threeOrMore;

      return {
        urbanRural: (r.urban_rural ?? 'U') as 'R' | 'U',
        tribal: (r.tribal_non ?? 'N') as 'T' | 'N',
        population: {
          noCoverage,
          oneProvider,
          twoProviders,
          threeOrMore,
          total,
        },
        coveragePct: total > 0 ? (covered / total) * 100 : 0,
        unservedPct: total > 0 ? (noCoverage / total) * 100 : 0,
        competitivePct: total > 0 ? (competitive / total) * 100 : 0,
      };
    });
  }

  /**
   * Fetches area table rows for multiple geography IDs and returns raw aggregated stats.
   */
  async getAreaStatsBatch(
    options: {
      geographyType: string;
      geographyIds: string[];
      techFilter: string;
      speedDown: string;
    },
    ctx: Context,
  ): Promise<
    Array<{
      id: string;
      type: string;
      tech: string;
      speed: string;
      noCoverage: number;
      oneProvider: number;
      twoProviders: number;
      threeOrMore: number;
      total: number;
    }>
  > {
    let rows = await this.fromMirror(ctx, 'area', (m) => m.areaStatsBatch(options));
    if (!rows) {
      const idList = options.geographyIds.map((id) => `'${id}'`).join(',');
      const conditions: string[] = [
        `type='${options.geographyType}'`,
        `id IN (${idList})`,
        `tech='${options.techFilter}'`,
        `speed='${options.speedDown}'`,
      ];

      rows = await this.fetchAllPages<RawAreaRow>(
        DATASET_IDS.AREA_TABLE,
        {
          $where: conditions.join(' AND '),
          $limit: DEFAULT_LIMIT,
        },
        ctx,
        MAX_LIMIT,
      );
    }

    const byId = accumulateAreaRows(rows);
    return Array.from(byId.values()).map((e) => ({
      ...e,
      type: options.geographyType,
      tech: options.techFilter,
      speed: options.speedDown,
    }));
  }

  /**
   * Scans every area table row matching a geography type and groups them by
   * GEOID. There is no caller-supplied row budget: the scan runs to the end of
   * the match or to `MAX_AREA_SCAN_ROWS`, and reports which of the two it was
   * so the caller can disclose an incomplete scan instead of ranking a prefix.
   */
  async getAreaStatsByType(
    options: {
      geographyType: string;
      techFilter: string;
      speedDown: string;
      urbanRuralFilter?: 'all' | 'R' | 'U';
      stateFipsPrefix?: string;
    },
    ctx: Context,
  ): Promise<AreaScanResult> {
    const mirrored = await this.fromMirror(ctx, 'area', (m) =>
      m.areaStatsByType({ ...options, maxRows: MAX_AREA_SCAN_ROWS }),
    );

    let rows: RawAreaRow[];
    let scanTruncated: boolean;

    if (mirrored) {
      // The store reports the full match count alongside the page it returned,
      // so the mirror path knows exactly what it left behind.
      rows = mirrored.rows;
      scanTruncated = mirrored.total > mirrored.rows.length;
    } else {
      const conditions: string[] = [
        `type='${options.geographyType}'`,
        `tech='${options.techFilter}'`,
        `speed='${options.speedDown}'`,
      ];

      if (options.urbanRuralFilter && options.urbanRuralFilter !== 'all') {
        conditions.push(`urban_rural='${options.urbanRuralFilter}'`);
      }

      if (options.stateFipsPrefix) {
        conditions.push(`id LIKE '${options.stateFipsPrefix}%'`);
      }

      const page = await this.fetchPagesUpTo<RawAreaRow>(
        DATASET_IDS.AREA_TABLE,
        {
          $where: conditions.join(' AND '),
          $limit: DEFAULT_LIMIT,
        },
        ctx,
        MAX_AREA_SCAN_ROWS,
      );
      rows = page.rows;
      scanTruncated = page.truncated;
    }

    if (scanTruncated) {
      ctx.log.warning('Area table scan stopped at the row ceiling', {
        geographyType: options.geographyType,
        scanRowCap: MAX_AREA_SCAN_ROWS,
      });
    }

    return {
      stats: Array.from(accumulateAreaRows(rows).values()),
      scanTruncated,
      scanRowCap: MAX_AREA_SCAN_ROWS,
    };
  }

  /**
   * Searches for providers by name/state/technology using the deployment table.
   */
  async searchProviders(
    options: {
      nameSearch?: string;
      state?: string;
      techCodes?: string[];
      limit?: number;
    },
    ctx: Context,
  ): Promise<ProviderRecord[]> {
    const baseLimit = Math.min(options.limit ?? 50, 200);
    const rowLimit = baseLimit * 10;

    let rows = await this.fromMirror(ctx, 'provider-dimension', (m) =>
      m.searchProviders({ ...options, rowLimit }),
    );
    if (!rows) {
      const conditions: string[] = [];
      if (options.nameSearch) {
        const escaped = options.nameSearch.replace(/'/g, "''");
        conditions.push(`upper(holdingcompanyname) LIKE upper('%${escaped}%')`);
      }
      if (options.state) {
        conditions.push(`stateabbr='${options.state}'`);
      }
      if (options.techCodes?.length) {
        const techList = options.techCodes.map((t) => `'${t}'`).join(',');
        conditions.push(`techcode IN (${techList})`);
      }

      const url = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
        $select: 'hoconum,holdingcompanyname,stateabbr,techcode',
        $group: 'hoconum,holdingcompanyname,stateabbr,techcode',
        ...(conditions.length > 0 ? { $where: conditions.join(' AND ') } : {}),
        /*
         * Socrata's GROUP BY over the 78M-row deployment table short-circuits
         * once $limit groups are found — measured live 2026-07-02:
         * '%communications%' at $limit=50 completes in ~7s while $limit=500
         * exceeds 55s. Name searches drop the 10x grouped-row headroom to stay
         * inside the 30s budget; the tradeoff is partial statesServed/techCodes
         * coverage per provider on the live path (the mirror is unaffected).
         */
        $limit: options.nameSearch ? baseLimit : rowLimit,
      });

      /*
       * This grouped query is load-bound by the input (match density decides
       * whether the scan short-circuits), so a deadline timeout is
       * deterministic — mark it non-retryable so withRetry fails once instead
       * of amplifying a ~30s failure 4x (~2min wall clock, issue #14).
       */
      rows = await this.fetchJson<RawProviderRow>(url, ctx, {
        timeoutError: () =>
          new McpError(
            JsonRpcErrorCode.Timeout,
            `FCC Open Data provider search timed out after ${TIMEOUT_MS / 1000}s — the grouped query over the 78M-row deployment table cannot complete for this input, and retrying will not help.`,
            {
              reason: 'live_search_timeout',
              retryable: false,
              recovery: {
                hint: 'Add a state filter or use a longer, more specific name fragment. Operators can enable the local Form 477 mirror (FCC_MIRROR_ENABLED=true) to serve provider searches locally.',
              },
            },
          ),
      });
    }

    const byHoconum = new Map<
      string,
      { hoconum: string; holdingCompanyName: string; states: Set<string>; techs: Set<string> }
    >();

    for (const r of rows) {
      const hoc = r.hoconum ?? '';
      if (!hoc) continue;
      let entry = byHoconum.get(hoc);
      if (!entry) {
        entry = {
          hoconum: hoc,
          holdingCompanyName: r.holdingcompanyname ?? '',
          states: new Set(),
          techs: new Set(),
        };
        byHoconum.set(hoc, entry);
      }
      if (r.stateabbr) entry.states.add(r.stateabbr);
      if (r.techcode) entry.techs.add(r.techcode);
    }

    const limit = options.limit ?? 50;
    return Array.from(byHoconum.values())
      .slice(0, limit)
      .map((e) => ({
        hoconum: e.hoconum,
        holdingCompanyName: e.holdingCompanyName,
        statesServed: Array.from(e.states).sort(),
        techCodes: Array.from(e.techs).sort(),
      }));
  }

  /**
   * Fetches the provider summary for a given hoconum.
   */
  async getProviderSummary(
    hoconum: string,
    ctx: Context,
  ): Promise<{
    hoconum: string;
    holdingCompanyName: string;
    techCodes: string[];
    speedTierLocations: Record<string, number>;
  } | null> {
    const fromMirror = await this.fromMirror(ctx, 'provider-summary', (m) =>
      m.providerSummary(hoconum),
    );
    if (fromMirror !== undefined) {
      if (fromMirror === null) return null;
      return {
        hoconum,
        holdingCompanyName: fromMirror.holdingCompanyName,
        techCodes: fromMirror.techCodes,
        speedTierLocations: sumSpeedTiers(fromMirror.summaryRows),
      };
    }

    const nameUrl = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
      $select: 'hoconum,holdingcompanyname',
      $where: `hoconum='${hoconum}'`,
      $group: 'hoconum,holdingcompanyname',
      $limit: 1,
    });

    const nameRows = await this.fetchJson<RawProviderRow>(nameUrl, ctx);
    if (nameRows.length === 0) {
      return null;
    }

    const holdingCompanyName = nameRows[0]?.holdingcompanyname ?? '';

    const techUrl = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
      $select: 'hoconum,techcode',
      $where: `hoconum='${hoconum}'`,
      $group: 'hoconum,techcode',
      $limit: 50,
    });

    const techRows = await this.fetchJson<RawProviderRow>(techUrl, ctx);
    const techCodes = [...new Set(techRows.map((r) => r.techcode ?? '').filter(Boolean))].sort();

    const summaryUrl = this.buildUrl(DATASET_IDS.PROVIDER_SUMMARY, {
      $where: `hoconum='${hoconum}'`,
      $limit: DEFAULT_LIMIT,
    });

    const summaryRows = await this.fetchJson<RawProviderSummaryRow>(summaryUrl, ctx);

    return {
      hoconum,
      holdingCompanyName,
      techCodes,
      speedTierLocations: sumSpeedTiers(summaryRows),
    };
  }

  /**
   * Resolves a GEOID to a human-readable name via the geography lookup table.
   */
  async getGeographyName(type: string, id: string, ctx: Context): Promise<string | undefined> {
    const geoId = type === 'nation' ? '0' : id;

    const fromMirror = await this.fromMirror(ctx, 'geography', (m) => m.geographyName(type, geoId));
    if (fromMirror) {
      return fromMirror.value;
    }

    const url = this.buildUrl(DATASET_IDS.GEOGRAPHY_LOOKUP, {
      $where: `geoid='${geoId}' AND type='${type}'`,
      $select: 'geoid,type,name',
      $limit: 1,
    });

    const rows = await this.fetchJson<RawGeographyRow>(url, ctx);
    return rows[0]?.name;
  }

  /**
   * Resolves multiple GEOIDs to human-readable names in a single query against
   * the geography lookup table, using the same `id IN (...)` batching pattern
   * as getAreaStatsBatch. Returns a GEOID → name map; IDs without a lookup
   * match are simply absent from the map.
   */
  async getGeographyNames(type: string, ids: string[], ctx: Context): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }

    const fromMirror = await this.fromMirror(ctx, 'geography', (m) => m.geographyNames(type, ids));
    if (fromMirror) {
      return fromMirror;
    }

    const idList = ids.map((id) => `'${id}'`).join(',');
    const rows = await this.fetchAllPages<RawGeographyRow>(
      DATASET_IDS.GEOGRAPHY_LOOKUP,
      {
        $where: `type='${type}' AND geoid IN (${idList})`,
        $select: 'geoid,type,name',
        $limit: DEFAULT_LIMIT,
      },
      ctx,
    );

    const names = new Map<string, string>();
    for (const r of rows) {
      if (r.geoid && r.name) {
        names.set(r.geoid, r.name);
      }
    }
    return names;
  }

  /**
   * Lists all distinct holding companies with hoconum identifiers.
   * Queries the smaller provider_summary table (7K rows, ~0.5s) instead of the full
   * deployment table (5M rows) which causes GROUP BY timeouts.
   * Names are not available in provider_summary; use fcc_search_providers to look up names.
   */
  async listAllProviders(ctx: Context): Promise<Array<{ hoconum: string }>> {
    const rows = await this.fetchAllPages<RawProviderSummaryRow>(
      DATASET_IDS.PROVIDER_SUMMARY,
      {
        $where: `tech='all'`,
        $select: 'hoconum',
        $order: 'hoconum ASC',
        $limit: DEFAULT_LIMIT,
      },
      ctx,
      MAX_LIMIT,
    );

    return rows.filter((r) => r.hoconum).map((r) => ({ hoconum: r.hoconum ?? '' }));
  }
}

// --- Init/accessor pattern ---

let _service: OpenDataService | undefined;

export function initOpenDataService(
  config: AppConfig,
  storage: StorageService,
  serverConfig: ServerConfig,
): void {
  // Construction is side-effect-free (nothing opens until a coverage check on
  // the first Form 477 request), so a disabled or unpopulated mirror costs
  // nothing at startup.
  const mirror = serverConfig.mirrorEnabled
    ? new Form477Mirror(serverConfig.mirrorPath)
    : undefined;
  _service = new OpenDataService(config, storage, serverConfig, mirror);
}

export function getOpenDataService(): OpenDataService {
  if (!_service) {
    throw new Error('OpenDataService not initialized — call initOpenDataService() in setup()');
  }
  return _service;
}
