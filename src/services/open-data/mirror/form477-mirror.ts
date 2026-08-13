/**
 * @fileoverview Read-side facade for the local Form 477 mirror. Each method
 * mirrors one OpenDataService query shape and returns rows in the same raw
 * shape the live Socrata API produces — or `undefined` when the mirror cannot
 * authoritatively serve the request, signalling the caller to fall back to the
 * live API silently.
 *
 * Serving rule (two tiers, because a partial mirror must never fake
 * completeness):
 * - Per-key/state-scopable reads serve only when the key's state (GEOID /
 *   blockcode 2-digit FIPS prefix) is marked fully covered.
 * - Cross-key aggregations (provider search/summary) and geography types whose
 *   GEOID embeds no state (cbsa, tribal, nation) serve only under the
 *   full-corpus marker.
 * @module services/open-data/mirror/form477-mirror
 */

import type { QueryFilter, SqlValue } from '@cyanheads/mcp-ts-core/mirror';
import type {
  RawAreaRow,
  RawDeploymentRow,
  RawProviderRow,
  RawProviderSummaryRow,
} from '../types.js';
import { isStateFips, prefixUpperBound, typeEmbedsState } from './state-fips.js';
import {
  closeForm477Stores,
  createForm477Stores,
  type Form477Stores,
  FULL_SCOPE,
  isCovered,
  MAX_PROVIDER_SUMMARY_ROWS,
  MAX_SCAN_ROWS,
  stateScope,
} from './stores.js';

function str(value: SqlValue | undefined): string | undefined {
  return value == null ? undefined : String(value);
}

/**
 * Drop undefined entries so mirror rows match the live raw-row shape exactly —
 * Socrata JSON omits null fields, and `exactOptionalPropertyTypes` forbids
 * assigning an explicit undefined to an optional property.
 */
function compact<T extends Record<string, string | undefined>>(
  obj: T,
): { [K in keyof T]?: string } {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]?: string };
}

/**
 * Translate a substring name search into an FTS5 phrase-prefix expression
 * (`"comc"* "cable"*`, implicit AND). Token-prefix matching, not arbitrary
 * substring — the practical equivalent for provider-name lookups.
 */
export function ftsPrefixQuery(input: string): string | undefined {
  const tokens = input.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return;
  return tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(' ');
}

export class Form477Mirror {
  readonly #stores: Form477Stores;
  readonly #coveredStates = new Set<string>();
  #full = false;
  #geographyReady = false;

  constructor(dir: string) {
    this.#stores = createForm477Stores(dir);
  }

  /** The backing stores — exposed for the lifecycle scripts and tests. */
  get stores(): Form477Stores {
    return this.#stores;
  }

  async close(): Promise<void> {
    await closeForm477Stores(this.#stores);
  }

  // -------------------------------------------------------------------------
  // Coverage gates (positive results memoized — coverage only ever grows)
  // -------------------------------------------------------------------------

  async #stateCovered(fips: string): Promise<boolean> {
    if (this.#coveredStates.has(fips)) return true;
    if (!isStateFips(fips)) return false;
    if (await isCovered(this.#stores.deployment, stateScope(fips))) {
      this.#coveredStates.add(fips);
      return true;
    }
    return false;
  }

  async #fullCorpus(): Promise<boolean> {
    if (this.#full) return true;
    if (await isCovered(this.#stores.deployment, FULL_SCOPE)) {
      this.#full = true;
      return true;
    }
    return false;
  }

  /** Gate for a geography key: state coverage when the GEOID embeds one, else full corpus. */
  #geoCovered(type: string, id: string): Promise<boolean> {
    if (typeEmbedsState(type)) return this.#stateCovered(id.slice(0, 2));
    return this.#fullCorpus();
  }

  async #geographyTableReady(): Promise<boolean> {
    if (this.#geographyReady) return true;
    const state = await this.#stores.geography.readState();
    this.#geographyReady = state.completedAt != null;
    return this.#geographyReady;
  }

  // -------------------------------------------------------------------------
  // Query shapes (undefined ⇒ caller serves live)
  // -------------------------------------------------------------------------

  async deploymentByBlock(
    blockFips: string,
    options: { techCodes?: string[]; minSpeedDown?: number; consumer?: boolean },
  ): Promise<RawDeploymentRow[] | undefined> {
    if (!(await this.#stateCovered(blockFips.slice(0, 2)))) return;
    const filters: QueryFilter[] = [{ column: 'blockcode', op: 'eq', value: blockFips }];
    if (options.techCodes?.length) {
      filters.push({ column: 'techcode', op: 'in', value: options.techCodes });
    }
    if (options.minSpeedDown !== undefined) {
      filters.push({ column: 'maxaddown', op: 'gte', value: options.minSpeedDown });
    }
    if (options.consumer === true) {
      filters.push({ column: 'consumer', op: 'eq', value: '1' });
    } else if (options.consumer === false) {
      filters.push({ column: 'business', op: 'eq', value: '1' });
    }
    const { rows } = await this.#stores.deployment.query({
      filters,
      limit: MAX_SCAN_ROWS,
      offset: 0,
    });
    return rows.map((r) =>
      compact({
        blockcode: str(r.blockcode),
        business: str(r.business),
        consumer: str(r.consumer),
        hoconum: str(r.hoconum),
        holdingcompanyname: str(r.holdingcompanyname),
        maxaddown: str(r.maxaddown),
        maxadup: str(r.maxadup),
        provider_id: str(r.provider_id),
        providername: str(r.providername),
        stateabbr: str(r.stateabbr),
        techcode: str(r.techcode),
      }),
    );
  }

  async areaSegments(options: {
    geographyType: string;
    geographyId: string;
    techFilter: string;
    speedDown: string;
    urbanRuralFilter?: 'all' | 'R' | 'U';
    tribalFilter?: 'all' | 'T' | 'N';
  }): Promise<RawAreaRow[] | undefined> {
    if (!(await this.#geoCovered(options.geographyType, options.geographyId))) return;
    const filters: QueryFilter[] = [
      { column: 'type', op: 'eq', value: options.geographyType },
      { column: 'id', op: 'eq', value: options.geographyId },
      { column: 'tech', op: 'eq', value: options.techFilter },
      { column: 'speed', op: 'eq', value: options.speedDown },
    ];
    if (options.urbanRuralFilter && options.urbanRuralFilter !== 'all') {
      filters.push({ column: 'urban_rural', op: 'eq', value: options.urbanRuralFilter });
    }
    if (options.tribalFilter && options.tribalFilter !== 'all') {
      filters.push({ column: 'tribal_non', op: 'eq', value: options.tribalFilter });
    }
    const { rows } = await this.#stores.area.query({ filters, limit: MAX_SCAN_ROWS, offset: 0 });
    return rows.map(toRawAreaRow);
  }

  async areaStatsBatch(options: {
    geographyType: string;
    geographyIds: string[];
    techFilter: string;
    speedDown: string;
  }): Promise<RawAreaRow[] | undefined> {
    if (typeEmbedsState(options.geographyType)) {
      const prefixes = new Set(options.geographyIds.map((id) => id.slice(0, 2)));
      for (const fips of prefixes) {
        if (!(await this.#stateCovered(fips))) return;
      }
    } else if (!(await this.#fullCorpus())) {
      return;
    }
    const { rows } = await this.#stores.area.query({
      filters: [
        { column: 'type', op: 'eq', value: options.geographyType },
        { column: 'id', op: 'in', value: options.geographyIds },
        { column: 'tech', op: 'eq', value: options.techFilter },
        { column: 'speed', op: 'eq', value: options.speedDown },
      ],
      limit: MAX_SCAN_ROWS,
      offset: 0,
    });
    return rows.map(toRawAreaRow);
  }

  async areaStatsByType(options: {
    geographyType: string;
    techFilter: string;
    speedDown: string;
    urbanRuralFilter?: 'all' | 'R' | 'U';
    stateFipsPrefix?: string;
    maxRows: number;
  }): Promise<RawAreaRow[] | undefined> {
    const prefix = options.stateFipsPrefix;
    const stateScoped = typeEmbedsState(options.geographyType) && prefix && /^\d{2}$/.test(prefix);
    const covered = stateScoped ? await this.#stateCovered(prefix) : await this.#fullCorpus();
    if (!covered) return;
    const filters: QueryFilter[] = [
      { column: 'type', op: 'eq', value: options.geographyType },
      { column: 'tech', op: 'eq', value: options.techFilter },
      { column: 'speed', op: 'eq', value: options.speedDown },
    ];
    if (options.urbanRuralFilter && options.urbanRuralFilter !== 'all') {
      filters.push({ column: 'urban_rural', op: 'eq', value: options.urbanRuralFilter });
    }
    if (prefix) {
      // `id LIKE '<prefix>%'` rewritten as a [gte, lt) range over the
      // zero-padded fixed-width GEOID so it stays within the query op set.
      filters.push({ column: 'id', op: 'gte', value: prefix });
      filters.push({ column: 'id', op: 'lt', value: prefixUpperBound(prefix) });
    }
    const { rows } = await this.#stores.area.query({
      filters,
      limit: Math.min(options.maxRows, MAX_SCAN_ROWS),
      offset: 0,
    });
    return rows.map(toRawAreaRow);
  }

  async searchProviders(options: {
    nameSearch?: string;
    state?: string;
    techCodes?: string[];
    rowLimit: number;
  }): Promise<RawProviderRow[] | undefined> {
    if (!(await this.#fullCorpus())) return;
    const filters: QueryFilter[] = [];
    if (options.state) filters.push({ column: 'stateabbr', op: 'eq', value: options.state });
    if (options.techCodes?.length) {
      filters.push({ column: 'techcode', op: 'in', value: options.techCodes });
    }
    const match = options.nameSearch ? ftsPrefixQuery(options.nameSearch) : undefined;
    const { rows } = await this.#stores.providerDim.query({
      ...(match ? { match } : {}),
      filters,
      limit: options.rowLimit,
      offset: 0,
    });
    return rows.map((r) =>
      compact({
        hoconum: str(r.hoconum),
        holdingcompanyname: str(r.holdingcompanyname),
        stateabbr: str(r.stateabbr),
        techcode: str(r.techcode),
      }),
    );
  }

  /**
   * Everything getProviderSummary needs in one shot. `null` means the provider
   * does not exist in the deployment corpus (an authoritative answer under the
   * full-corpus marker); `undefined` means serve live.
   */
  async providerSummary(
    hoconum: string,
  ): Promise<
    | { holdingCompanyName: string; techCodes: string[]; summaryRows: RawProviderSummaryRow[] }
    | null
    | undefined
  > {
    if (!(await this.#fullCorpus())) return;
    const dim = await this.#stores.providerDim.query({
      filters: [{ column: 'hoconum', op: 'eq', value: hoconum }],
      limit: MAX_PROVIDER_SUMMARY_ROWS,
      offset: 0,
    });
    if (dim.rows.length === 0) return null;
    const holdingCompanyName = str(dim.rows[0]?.holdingcompanyname) ?? '';
    const techCodes = [
      ...new Set(dim.rows.map((r) => str(r.techcode) ?? '').filter(Boolean)),
    ].sort();
    const summary = await this.#stores.providerSummary.query({
      filters: [{ column: 'hoconum', op: 'eq', value: hoconum }],
      limit: MAX_PROVIDER_SUMMARY_ROWS,
      offset: 0,
    });
    const summaryRows = summary.rows.map((r) =>
      compact({
        d_1: str(r.d_1),
        d_2: str(r.d_2),
        d_3: str(r.d_3),
        d_4: str(r.d_4),
        d_5: str(r.d_5),
        d_6: str(r.d_6),
        d_7: str(r.d_7),
        d_8: str(r.d_8),
        hoconum: str(r.hoconum),
      }),
    );
    return { holdingCompanyName, techCodes, summaryRows };
  }

  /**
   * Geography name lookup. The outer `undefined` means serve live; the inner
   * `value` may itself be undefined when the mirror authoritatively has no name
   * for the GEOID (matching the live API's empty result).
   */
  async geographyName(
    type: string,
    geoId: string,
  ): Promise<{ value: string | undefined } | undefined> {
    if (!(await this.#geographyTableReady())) return;
    if (!(await this.#geoCovered(type, geoId))) return;
    const { rows } = await this.#stores.geography.query({
      filters: [
        { column: 'geoid', op: 'eq', value: geoId },
        { column: 'type', op: 'eq', value: type },
      ],
      limit: 1,
      offset: 0,
    });
    return { value: str(rows[0]?.name) };
  }

  async geographyNames(type: string, ids: string[]): Promise<Map<string, string> | undefined> {
    if (!(await this.#geographyTableReady())) return;
    if (typeEmbedsState(type)) {
      const prefixes = new Set(ids.map((id) => id.slice(0, 2)));
      for (const fips of prefixes) {
        if (!(await this.#stateCovered(fips))) return;
      }
    } else if (!(await this.#fullCorpus())) {
      return;
    }
    const { rows } = await this.#stores.geography.query({
      filters: [
        { column: 'type', op: 'eq', value: type },
        { column: 'geoid', op: 'in', value: ids },
      ],
      limit: MAX_SCAN_ROWS,
      offset: 0,
    });
    const names = new Map<string, string>();
    for (const r of rows) {
      const geoid = str(r.geoid);
      const name = str(r.name);
      if (geoid && name) names.set(geoid, name);
    }
    return names;
  }
}

function toRawAreaRow(r: Record<string, SqlValue>): RawAreaRow {
  return compact({
    has_0: str(r.has_0),
    has_1: str(r.has_1),
    has_2: str(r.has_2),
    has_3more: str(r.has_3more),
    id: str(r.id),
    speed: str(r.speed),
    tech: str(r.tech),
    tribal_non: str(r.tribal_non),
    type: str(r.type),
    urban_rural: str(r.urban_rural),
  });
}
