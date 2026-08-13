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
  PROVIDER_SUMMARY_ROLLUP_TECHS,
  type ProviderFootprint,
  type ProviderSearchResult,
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

/**
 * Raw deployment rows one live provider search reads before deduplicating by
 * holding company.
 *
 * Cost tracks how far Socrata must scan to collect `$limit` matching rows, not
 * how many rows match overall, so a window bought coverage at the price of the
 * two shapes that matter most. Measured 2026-08-13 against the June 2021
 * snapshot: at 20,000 rows a broad `'%Tele%'` answered in 1.5s with 461 of its
 * 562 holding companies, but a full-name search for one small carrier
 * (`'%Arapahoe Telephone%'`) took 44s and a name matching nothing took 42s —
 * both past the deadline, and both are what a caller resolving a name to a
 * hoconum actually types. At 1,000 rows every shape lands inside the budget:
 * 0.7–1.7s for dense and rare matches alike, 6.9s worst case, 6.7s for a name
 * matching nothing. What it costs is sample breadth (165 of those 562, still
 * over three times the default page), which `scanTruncated` discloses.
 *
 * The window is deliberately unordered — `$order` sorts every matching row
 * before the window is taken, which collapses the page onto whichever holding
 * company sorts first (one provider instead of hundreds, measured).
 */
const PROVIDER_SEARCH_SCAN_ROWS = 1_000;

/**
 * Single-hoconum name lookups one directory page keeps in flight. Each is an
 * indexed point query; six at a time resolves a 25-entry page in about a second.
 */
const PROVIDER_NAME_CONCURRENCY = 6;

/**
 * Single-hoconum footprint lookups one provider search keeps in flight. A
 * search page runs to 200 companies where a directory page runs to 25, and the
 * footprint group is the heavier of the two queries, so it fans out wider.
 * Measured 2026-08-13 over 200 companies: 8.4s at twelve in flight against 6.7s
 * at twenty, both without a single upstream rejection — the extra pressure buys
 * little, so this sits at the lower of the two.
 */
const PROVIDER_FOOTPRINT_CONCURRENCY = 12;

/**
 * Rows one footprint query may return — a holding company's distinct
 * state × technology combinations. The columns' own domains bound the shape at
 * 56 jurisdictions × 10 technology codes, and the widest carrier in the June
 * 2021 snapshot files 259 combinations, so this ceiling never binds.
 */
const MAX_FOOTPRINT_COMBOS = 1_000;

/**
 * A deadline on either half of a provider search is not a transient hiccup —
 * every measured shape of the windowed read, a name matching nothing included,
 * lands inside seven seconds, and a single-hoconum footprint group stays near a
 * second — so a 30s breach means the dataset will not serve it, and three more
 * attempts only spend two minutes reaching the same answer (#14).
 */
function searchTimeoutError(): McpError {
  return new McpError(
    JsonRpcErrorCode.Timeout,
    `FCC Open Data provider search timed out after ${TIMEOUT_MS / 1000}s — retrying will not help.`,
    {
      reason: 'live_search_timeout',
      retryable: false,
      recovery: {
        hint: 'FCC Open Data is not serving this search right now; try again later. Operators can enable the local Form 477 mirror (FCC_MIRROR_ENABLED=true) to search holding-company names locally.',
      },
    },
  );
}

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

const SPEED_TIERS = ['d_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8'] as const;

/**
 * Population covered at each download speed tier, read off the provider
 * summary's `tech='all'` row — the FCC's own non-overlapping national total.
 * Summing the rows instead multiplies the same population by however many
 * roll-ups and technologies the provider reports. Empty when the provider has
 * no rows in the summary table, which is how business-only carriers appear:
 * present in the deployment table, absent from the population rollup.
 */
function nationalSpeedTiers(rows: RawProviderSummaryRow[]): Record<string, number> {
  const rollup = rows.find((row) => row.tech === 'all');
  if (!rollup) return {};
  const tiers: Record<string, number> = {};
  for (const tier of SPEED_TIERS) {
    tiers[tier] = parseInt(rollup[tier] ?? '0', 10);
  }
  return tiers;
}

/** The individual technology codes behind a provider's summary rows, roll-ups excluded. */
function technologyCodes(rows: RawProviderSummaryRow[]): string[] {
  const codes = rows
    .map((row) => row.tech ?? '')
    .filter((tech) => tech && !PROVIDER_SUMMARY_ROLLUP_TECHS.has(tech));
  return [...new Set(codes)].sort();
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
   * A holding company's whole national footprint — every state it filed in and
   * every technology it deployed — one company at a time.
   *
   * The provider search reads a bounded window of raw deployment rows, so the
   * states and technologies visible inside that window are a subset of what a
   * company actually filed: for Comcast a 1,000-row window shows 3 of its 5
   * technology codes and 37 of its 49 states (measured 2026-08-13). Grouping
   * `stateabbr, techcode` under a single-hoconum `$where` is indexed and stays
   * near a second even for the largest carriers; the same grouping under an
   * `IN (…)` list is not (32s for two large carriers against 3.4s for the same
   * two one at a time), so this fans out point queries instead of batching
   * them. Nothing here narrows the footprint to the search's own filters — the
   * filters choose which companies come back, not what is true of them.
   *
   * Hoconums arrive from upstream JSON and are interpolated into SoQL, so
   * anything but digits is not a hoconum and is dropped rather than queried.
   */
  private async providerFootprints(
    hoconums: string[],
    ctx: Context,
  ): Promise<Map<string, ProviderFootprint>> {
    const mirrored = await this.fromMirror(ctx, 'provider-dimension', (m) =>
      m.providerFootprints(hoconums),
    );
    if (mirrored) return mirrored;

    const footprints = new Map<string, ProviderFootprint>();
    const pending = hoconums.filter((h) => /^\d+$/.test(h));

    const resolve = async (): Promise<void> => {
      for (let hoconum = pending.pop(); hoconum !== undefined; hoconum = pending.pop()) {
        const url = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
          $select: 'stateabbr,techcode',
          $where: `hoconum='${hoconum}'`,
          $group: 'stateabbr,techcode',
          $limit: MAX_FOOTPRINT_COMBOS,
        });
        const rows = await this.fetchJson<RawProviderRow>(url, ctx, {
          timeoutError: searchTimeoutError,
        });
        const states = new Set<string>();
        const techs = new Set<string>();
        for (const r of rows) {
          if (r.stateabbr) states.add(r.stateabbr);
          if (r.techcode) techs.add(r.techcode);
        }
        footprints.set(hoconum, { states: [...states].sort(), techs: [...techs].sort() });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PROVIDER_FOOTPRINT_CONCURRENCY, pending.length) }, resolve),
    );
    return footprints;
  }

  /**
   * Searches for providers by name/state/technology, deduplicating by holding
   * company here rather than upstream.
   *
   * The live query carries no `$group`: aggregating the deployment table is
   * bounded by how many rows match before grouping, not by how narrow the
   * `$where` looks, and a `LIKE '%fragment%'` on `holdingcompanyname` cannot
   * use an index at all — so no combination of name, state, and technology
   * filters keeps it inside the 30s budget (measured 2026-08-13: `'%Tele%'`
   * grouped by hoconum took 45s, `'%Comcast%'` 44s, and the four-column group
   * this replaces 87s, while the same predicates ungrouped answer in about a
   * second). What that costs is completeness, and `scanTruncated` is how the
   * caller learns of it: a bounded window of raw rows cannot see every matching
   * holding company, and the true match count needs the grouping that does not
   * work. The mirror path stays complete — its FTS5 index over the
   * holding-company name reaches every match.
   *
   * The window decides *which* companies come back and nothing else. Every
   * attribute of a returned company is resolved from the whole corpus by
   * {@link providerFootprints}, because a window drawn from block-level rows
   * covers a large carrier's blocks far more thinly than its states and
   * technologies, and reporting what such a window happened to contain as the
   * company's footprint understates it without saying so.
   */
  async searchProviders(
    options: {
      nameSearch?: string;
      state?: string;
      techCodes?: string[];
      limit?: number;
    },
    ctx: Context,
  ): Promise<ProviderSearchResult> {
    const baseLimit = Math.min(options.limit ?? 50, 200);
    const mirrorRowLimit = baseLimit * 10;

    let scanRowCap = mirrorRowLimit;
    let rows = await this.fromMirror(ctx, 'provider-dimension', (m) =>
      m.searchProviders({ ...options, rowLimit: mirrorRowLimit }),
    );
    if (!rows) {
      scanRowCap = PROVIDER_SEARCH_SCAN_ROWS;
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

      // Identity only: the state and technology columns are filtered on but not
      // selected, since the footprint pass supersedes anything read off them.
      const url = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
        $select: 'hoconum,holdingcompanyname',
        ...(conditions.length > 0 ? { $where: conditions.join(' AND ') } : {}),
        $limit: PROVIDER_SEARCH_SCAN_ROWS,
      });

      rows = await this.fetchJson<RawProviderRow>(url, ctx, {
        timeoutError: searchTimeoutError,
      });
    }

    /*
     * The window is read for identity alone — which holding companies match —
     * so only the first name seen for a hoconum is kept. Whichever row that is,
     * it satisfied the search's own `$where`, which is what makes it the right
     * name to show against a name search.
     */
    const byHoconum = new Map<string, string>();
    for (const r of rows) {
      const hoc = r.hoconum ?? '';
      if (!hoc || byHoconum.has(hoc)) continue;
      byHoconum.set(hoc, r.holdingcompanyname ?? '');
    }

    const matches = Array.from(byHoconum, ([hoconum, holdingCompanyName]) => ({
      hoconum,
      holdingCompanyName,
    }));
    const page = matches.slice(0, options.limit ?? 50);
    const footprints = await this.providerFootprints(
      page.map((e) => e.hoconum),
      ctx,
    );

    return {
      matched: matches.length,
      providers: page.map((entry) => {
        // A hoconum with no deployment rows has an empty footprint, which is
        // what an absent map entry means and what the live path returns for it.
        const footprint = footprints.get(entry.hoconum);
        return {
          hoconum: entry.hoconum,
          holdingCompanyName: entry.holdingCompanyName,
          statesServed: footprint?.states ?? [],
          techCodes: footprint?.techs ?? [],
        };
      }),
      scanRowCap,
      // A short read is the end of the match; a full one only proves the window filled.
      scanTruncated: rows.length >= scanRowCap,
    };
  }

  /**
   * Fetches the national profile for one holding company: its name from the
   * deployment table, its covered population and technology codes from the
   * provider summary table. `null` when no deployment row carries the hoconum.
   *
   * Both queries are single-key point lookups — no `GROUP BY`. Grouping the
   * 78M-row deployment table by one hoconum is bounded by how many rows match
   * before grouping, not by the filter's selectivity, so it runs for tens of
   * seconds on the large multi-state carriers most likely to be looked up
   * (issue #29). The name needs one row and no aggregation, and the technology
   * codes are already in the summary rows fetched alongside it.
   *
   * `hoconum` is interpolated directly: the tool schema constrains it to digits
   * before it reaches here, matching the column's own numeric type.
   */
  async getProviderSummary(
    hoconum: string,
    ctx: Context,
  ): Promise<{
    hoconum: string;
    holdingCompanyName: string;
    techCodes: string[];
    speedTierPopulation: Record<string, number>;
  } | null> {
    const fromMirror = await this.fromMirror(ctx, 'provider-summary', (m) =>
      m.providerSummary(hoconum),
    );
    if (fromMirror !== undefined) {
      if (fromMirror === null) return null;
      return {
        hoconum,
        holdingCompanyName: fromMirror.holdingCompanyName,
        techCodes: technologyCodes(fromMirror.summaryRows),
        speedTierPopulation: nationalSpeedTiers(fromMirror.summaryRows),
      };
    }

    /*
     * A deadline here is not a transient hiccup — these are sub-second point
     * queries, so a 30s breach means the dataset will not serve them, and three
     * more attempts only spend two minutes reaching the same answer (issue #14
     * on searchProviders, same amplification).
     */
    const timeoutError = () =>
      new McpError(
        JsonRpcErrorCode.Timeout,
        `FCC Open Data provider lookup timed out after ${TIMEOUT_MS / 1000}s — retrying will not help.`,
        {
          reason: 'live_provider_timeout',
          retryable: false,
          recovery: {
            hint: 'FCC Open Data is not serving this lookup right now; try again later. Operators can enable the local Form 477 mirror (FCC_MIRROR_ENABLED=true) to serve provider profiles locally.',
          },
        },
      );

    const nameUrl = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
      $select: 'hoconum,holdingcompanyname',
      $where: `hoconum='${hoconum}'`,
      $limit: 1,
    });
    const summaryUrl = this.buildUrl(DATASET_IDS.PROVIDER_SUMMARY, {
      $where: `hoconum='${hoconum}'`,
      $limit: DEFAULT_LIMIT,
    });

    const [nameRows, summaryRows] = await Promise.all([
      this.fetchJson<RawProviderRow>(nameUrl, ctx, { timeoutError }),
      this.fetchJson<RawProviderSummaryRow>(summaryUrl, ctx, { timeoutError }),
    ]);

    if (nameRows.length === 0) {
      return null;
    }

    return {
      hoconum,
      holdingCompanyName: nameRows[0]?.holdingcompanyname ?? '',
      techCodes: technologyCodes(summaryRows),
      speedTierPopulation: nationalSpeedTiers(summaryRows),
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
   * One page of the holding-company directory, ordered by hoconum ascending,
   * with the directory's full size alongside it.
   *
   * Reads the provider summary table's `tech='all'` rows — one per holding
   * company, ~2.2K of them — rather than grouping the deployment table, which
   * is what made this enumeration time out (issue #4). One row per company
   * makes hoconum a unique sort key, so `offset` addresses the same page on
   * every read of the frozen June 2021 snapshot. An offset past the end is not
   * an error: it comes back empty next to a non-zero `total`, which is what
   * separates an exhausted page from an empty directory.
   */
  async listProviders(
    options: { limit: number; offset: number },
    ctx: Context,
  ): Promise<{ providers: Array<{ hoconum: string }>; total: number }> {
    const pageUrl = this.buildUrl(DATASET_IDS.PROVIDER_SUMMARY, {
      $select: 'hoconum',
      $where: `tech='all'`,
      $order: 'hoconum ASC',
      $limit: options.limit,
      $offset: options.offset,
    });
    const countUrl = this.buildUrl(DATASET_IDS.PROVIDER_SUMMARY, {
      $select: 'count(1) AS total',
      $where: `tech='all'`,
    });

    const [rows, counts] = await Promise.all([
      this.fetchJson<RawProviderSummaryRow>(pageUrl, ctx),
      this.fetchJson<{ total?: string }>(countUrl, ctx),
    ]);

    return {
      providers: rows.filter((r) => r.hoconum).map((r) => ({ hoconum: r.hoconum ?? '' })),
      total: parseInt(counts[0]?.total ?? '0', 10),
    };
  }

  /**
   * Resolves holding company numbers to names, one indexed point query each.
   *
   * The deployment table is the only one carrying holding-company names, and it
   * offers no shape that returns many of them in one pass: `$group` over it is
   * bounded by matching rows rather than by the key list (5.2s for 25 keys,
   * 44s for one large carrier — measured 2026-08-13), and an ungrouped
   * `hoconum IN (…)` window fills with whichever company has the most block
   * rows. A point query per hoconum is indexed and sub-second, so a page
   * resolves in about a second with {@link PROVIDER_NAME_CONCURRENCY} in
   * flight. Names decorate an identifier the caller already holds, so a lookup
   * that fails is logged and left out of the map rather than failing the page.
   */
  async getProviderNames(hoconums: string[], ctx: Context): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    // These values arrive from upstream JSON and are interpolated into SoQL.
    // The column is numeric, so anything else is not a hoconum.
    const pending = hoconums.filter((h) => /^\d+$/.test(h));

    const resolve = async (): Promise<void> => {
      for (let hoconum = pending.pop(); hoconum !== undefined; hoconum = pending.pop()) {
        const url = this.buildUrl(DATASET_IDS.DEPLOYMENT, {
          $select: 'hoconum,holdingcompanyname',
          $where: `hoconum='${hoconum}'`,
          $limit: 1,
        });
        const rows = await this.fetchJson<RawProviderRow>(url, ctx).catch((error: unknown) => {
          ctx.log.debug('Holding-company name lookup failed — name omitted', {
            hoconum,
            error: error instanceof Error ? error.message : String(error),
          });
          return [] as RawProviderRow[];
        });
        const name = rows[0]?.holdingcompanyname;
        if (name) names.set(hoconum, name);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PROVIDER_NAME_CONCURRENCY, pending.length) }, resolve),
    );
    return names;
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
