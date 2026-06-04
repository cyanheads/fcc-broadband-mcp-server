/**
 * @fileoverview FCC Open Data (Socrata) service — wraps opendata.fcc.gov for Form 477 data.
 * Provides access to block-level deployment, area coverage summaries, and provider data.
 * All Form 477 data is as of June 2021 (the last filing period before BDC replaced it).
 * @module services/open-data/open-data-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { ServerConfig } from '@/config/server-config.js';
import {
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
  ) {}

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

  private fetchJson<T>(url: string, ctx: Context): Promise<T[]> {
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
   * Fetches all pages of results for a SoQL query, up to `maxRows` rows.
   */
  private async fetchAllPages<T>(
    datasetId: string,
    params: SoqlParams,
    ctx: Context,
    maxRows = MAX_LIMIT,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    const limit = Math.min(params.$limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);

    while (results.length < maxRows) {
      const url = this.buildUrl(datasetId, { ...params, $limit: limit, $offset: offset });
      const page = await this.fetchJson<T>(url, ctx);
      results.push(...page);
      if (page.length < limit) break;
      offset += limit;
    }

    return results.slice(0, maxRows);
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

    const rows = await this.fetchAllPages<RawDeploymentRow>(
      DATASET_IDS.DEPLOYMENT,
      {
        $where: conditions.join(' AND '),
        $limit: DEFAULT_LIMIT,
      },
      ctx,
    );

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

    const rows = await this.fetchAllPages<RawAreaRow>(
      DATASET_IDS.AREA_TABLE,
      {
        $where: conditions.join(' AND '),
        $limit: 100,
      },
      ctx,
    );

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
    const idList = options.geographyIds.map((id) => `'${id}'`).join(',');
    const conditions: string[] = [
      `type='${options.geographyType}'`,
      `id IN (${idList})`,
      `tech='${options.techFilter}'`,
      `speed='${options.speedDown}'`,
    ];

    const rows = await this.fetchAllPages<RawAreaRow>(
      DATASET_IDS.AREA_TABLE,
      {
        $where: conditions.join(' AND '),
        $limit: DEFAULT_LIMIT,
      },
      ctx,
      MAX_LIMIT,
    );

    const byId = accumulateAreaRows(rows);
    return Array.from(byId.values()).map((e) => ({
      ...e,
      type: options.geographyType,
      tech: options.techFilter,
      speed: options.speedDown,
    }));
  }

  /**
   * Fetches area table rows for geographies matching a type.
   */
  async getAreaStatsByType(
    options: {
      geographyType: string;
      techFilter: string;
      speedDown: string;
      urbanRuralFilter?: 'all' | 'R' | 'U';
      stateFipsPrefix?: string;
      limit?: number;
    },
    ctx: Context,
  ): Promise<
    Array<{
      id: string;
      noCoverage: number;
      oneProvider: number;
      twoProviders: number;
      threeOrMore: number;
      total: number;
    }>
  > {
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

    const maxRows = Math.min(options.limit ?? 10000, MAX_LIMIT);
    const rows = await this.fetchAllPages<RawAreaRow>(
      DATASET_IDS.AREA_TABLE,
      {
        $where: conditions.join(' AND '),
        $limit: DEFAULT_LIMIT,
      },
      ctx,
      maxRows,
    );

    return Array.from(accumulateAreaRows(rows).values());
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
      $limit: Math.min(options.limit ?? 50, 200) * 10,
    });

    const rows = await this.fetchJson<RawProviderRow>(url, ctx);

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

    const tierTotals: Record<string, number> = {};
    for (const row of summaryRows) {
      for (const tier of ['d_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8'] as const) {
        const val = parseInt(row[tier] ?? '0', 10);
        tierTotals[tier] = (tierTotals[tier] ?? 0) + val;
      }
    }

    return { hoconum, holdingCompanyName, techCodes, speedTierLocations: tierTotals };
  }

  /**
   * Resolves a GEOID to a human-readable name via the geography lookup table.
   */
  async getGeographyName(type: string, id: string, ctx: Context): Promise<string | undefined> {
    const geoId = type === 'nation' ? '0' : id;
    const url = this.buildUrl(DATASET_IDS.GEOGRAPHY_LOOKUP, {
      $where: `geoid='${geoId}' AND type='${type}'`,
      $select: 'geoid,type,name',
      $limit: 1,
    });

    const rows = await this.fetchJson<RawGeographyRow>(url, ctx);
    return rows[0]?.name;
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
  _service = new OpenDataService(config, storage, serverConfig);
}

export function getOpenDataService(): OpenDataService {
  if (!_service) {
    throw new Error('OpenDataService not initialized — call initOpenDataService() in setup()');
  }
  return _service;
}
