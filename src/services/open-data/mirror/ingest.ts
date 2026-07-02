/**
 * @fileoverview One-time ingest pipeline for the Form 477 mirror. Pages the
 * Socrata CSV export (`$select` narrowed to the columns the service reads,
 * `$limit=50000`/`$offset`, `$order=:id` for stable paging) into the SQLite
 * stores via the framework's sync runner.
 *
 * The corpus is frozen (June 2021 was the last Form 477 filing period), so
 * there is no refresh loop — ingest is init-only. Ingest units are state-scoped:
 * each state drains the deployment table (by `stateabbr`) and the state-embedded
 * area rows (GEOID prefix range), then is marked covered exactly once. Full mode
 * runs every state, then the non-state-scoped area types (cbsa/tribal/nation),
 * then writes the full-corpus marker. The provider dimension is derived from
 * deployment pages as they stream.
 * @module services/open-data/mirror/ingest
 */

import {
  defineMirror,
  type MirrorLogger,
  type MirrorRow,
  type MirrorStore,
} from '@cyanheads/mcp-ts-core/mirror';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { parseCsv } from './csv.js';
import { ALL_STATE_FIPS, isStateFips, prefixUpperBound, STATE_FIPS_TO_ABBR } from './state-fips.js';
import { type Form477Stores, FULL_SCOPE, isCovered, markCovered, stateScope } from './stores.js';

const BASE_URL = 'https://opendata.fcc.gov/resource';
const PAGE_SIZE = 50_000;
const PAGE_TIMEOUT_MS = 180_000;
const DEFAULT_PAGE_DELAY_MS = 250;

/** Area-table scope for the geography types whose GEOIDs embed no state. */
export const NATIONAL_AREA_SCOPE = 'national';

const DEPLOYMENT_SELECT =
  ':id as sid,blockcode,provider_id,providername,holdingcompanyname,hoconum,stateabbr,techcode,maxaddown,maxadup,consumer,business';
const AREA_SELECT =
  ':id as sid,type,id,tech,speed,urban_rural,tribal_non,has_0,has_1,has_2,has_3more';
const PROVIDER_SUMMARY_SELECT = ':id as sid,hoconum,tech,d_1,d_2,d_3,d_4,d_5,d_6,d_7,d_8';
const GEOGRAPHY_SELECT = ':id as sid,geoid,type,name';

/** Options shared by every ingest entry point. */
export interface IngestOptions {
  /** Socrata app token — raises rate limits for the long page loop. */
  appToken?: string | undefined;
  log?: MirrorLogger | undefined;
  /** Politeness delay between pages. Default 250 ms. */
  pageDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function fetchCsvPage(
  datasetId: string,
  params: { select: string; where: string; offset: number },
  options: IngestOptions,
): Promise<Record<string, string>[]> {
  const url = new URL(`${BASE_URL}/${datasetId}.csv`);
  url.searchParams.set('$select', params.select);
  if (params.where) url.searchParams.set('$where', params.where);
  url.searchParams.set('$order', ':id');
  url.searchParams.set('$limit', String(PAGE_SIZE));
  url.searchParams.set('$offset', String(params.offset));
  if (options.appToken) url.searchParams.set('$$app_token', options.appToken);

  return withRetry(
    async () => {
      const timeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`FCC Open Data returned ${response.status} for ${datasetId} export.`);
      }
      return parseCsv(await response.text());
    },
    {
      operation: 'Form477MirrorIngest.fetchCsvPage',
      baseDelayMs: 2000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
}

/** Resume offset from a persisted cursor, honored only when the scope matches. */
function resumeOffset(cursor: string | undefined, scope: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(cursor) as { scope?: string; offset?: number };
    if (parsed.scope === scope && typeof parsed.offset === 'number') return parsed.offset;
  } catch {
    // Unparseable cursor from an older layout — start the scope from zero.
  }
  return 0;
}

function toRealOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function requireSid(row: Record<string, string>, datasetId: string): string {
  const sid = row.sid;
  if (!sid) {
    throw new Error(`Socrata CSV export for ${datasetId} returned a row without ':id as sid'.`);
  }
  return sid;
}

/**
 * Generic paged CSV drain for one dataset scope. Yields raw CSV pages plus the
 * `{ scope, offset }` resume cursor; callers map rows and forward to the runner.
 */
async function* pagedCsv(
  datasetId: string,
  scope: string,
  select: string,
  where: string,
  cursor: string | undefined,
  options: IngestOptions,
): AsyncGenerator<{ rows: Record<string, string>[]; cursor: string }> {
  let offset = resumeOffset(cursor, scope);
  const delayMs = options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;
  for (;;) {
    options.signal?.throwIfAborted();
    const rows = await fetchCsvPage(datasetId, { select, where, offset }, options);
    offset += rows.length;
    options.log?.info?.('Fetched page', { datasetId, scope, offset, pageRows: rows.length });
    yield { rows, cursor: JSON.stringify({ scope, offset }) };
    if (rows.length < PAGE_SIZE) return;
    await sleep(delayMs, options.signal);
  }
}

/** Distinct provider-dimension combos present in a deployment CSV page. */
function dimCombos(rows: Record<string, string>[]): MirrorRow[] {
  const combos = new Map<string, MirrorRow>();
  for (const r of rows) {
    const hoconum = r.hoconum ?? '';
    if (!hoconum) continue;
    const stateabbr = r.stateabbr ?? '';
    const techcode = r.techcode ?? '';
    const combo = `${hoconum}|${stateabbr}|${techcode}`;
    if (!combos.has(combo)) {
      combos.set(combo, {
        combo,
        hoconum,
        holdingcompanyname: r.holdingcompanyname ?? '',
        stateabbr,
        techcode,
      });
    }
  }
  return [...combos.values()];
}

function mapDeploymentRow(r: Record<string, string>): MirrorRow {
  return {
    sid: requireSid(r, 'jdr4-3q4p'),
    blockcode: r.blockcode ?? '',
    provider_id: r.provider_id ?? '',
    providername: r.providername ?? '',
    holdingcompanyname: r.holdingcompanyname ?? '',
    hoconum: r.hoconum ?? '',
    stateabbr: r.stateabbr ?? '',
    techcode: r.techcode ?? '',
    maxaddown: toRealOrNull(r.maxaddown),
    maxadup: toRealOrNull(r.maxadup),
    consumer: r.consumer ?? '',
    business: r.business ?? '',
  };
}

/**
 * Drain one state's deployment rows, folding each page's distinct provider
 * combos into the dimension store before the page persists. Combos re-derive
 * identically on a re-run, so the early dimension write is harmless.
 */
async function runDeploymentState(
  stores: Form477Stores,
  fips: string,
  options: IngestOptions,
): Promise<void> {
  const abbr = STATE_FIPS_TO_ABBR[fips] as string;
  const scope = stateScope(fips);
  const mirror = defineMirror({
    name: `fcc-477-deployment-${fips}`,
    store: stores.deployment,
    ...(options.log ? { logger: options.log } : {}),
    async *sync({ cursor }) {
      for await (const page of pagedCsv(
        'jdr4-3q4p',
        scope,
        DEPLOYMENT_SELECT,
        `stateabbr='${abbr}'`,
        cursor,
        options,
      )) {
        await stores.providerDim.applyBatch(dimCombos(page.rows), []);
        yield { records: page.rows.map(mapDeploymentRow), cursor: page.cursor };
      }
    },
  });
  await mirror.runSync({ mode: 'init', ...(options.signal ? { signal: options.signal } : {}) });
}

/** Drain one area-table scope (a state's embedded-GEOID rows, or the national slice). */
async function runAreaScope(
  stores: Form477Stores,
  scope: string,
  options: IngestOptions,
): Promise<void> {
  const where =
    scope === NATIONAL_AREA_SCOPE
      ? `type in ('cbsa','tribal','nation')`
      : (() => {
          const fips = scope.slice('state:'.length);
          return `type in ('state','county','cd','place') AND id >= '${fips}' AND id < '${prefixUpperBound(fips)}'`;
        })();
  const mirror = defineMirror({
    name: `fcc-477-area-${scope}`,
    store: stores.area,
    ...(options.log ? { logger: options.log } : {}),
    async *sync({ cursor }) {
      for await (const page of pagedCsv('xvwq-qtaj', scope, AREA_SELECT, where, cursor, options)) {
        yield {
          records: page.rows.map((r) => ({
            sid: requireSid(r, 'xvwq-qtaj'),
            type: r.type ?? '',
            id: r.id ?? '',
            tech: r.tech ?? '',
            speed: r.speed ?? '',
            urban_rural: r.urban_rural ?? '',
            tribal_non: r.tribal_non ?? '',
            has_0: r.has_0 ?? '',
            has_1: r.has_1 ?? '',
            has_2: r.has_2 ?? '',
            has_3more: r.has_3more ?? '',
          })),
          cursor: page.cursor,
        };
      }
    },
  });
  await mirror.runSync({ mode: 'init', ...(options.signal ? { signal: options.signal } : {}) });
}

/** Drain a small full-table store (geography lookup / provider summary) once. */
async function runSmallTable(
  store: MirrorStore,
  name: string,
  datasetId: string,
  select: string,
  map: (r: Record<string, string>) => MirrorRow,
  options: IngestOptions,
): Promise<void> {
  const state = await store.readState();
  if (state.completedAt) return; // frozen corpus — a completed drain never re-runs
  const mirror = defineMirror({
    name,
    store,
    ...(options.log ? { logger: options.log } : {}),
    async *sync({ cursor }) {
      for await (const page of pagedCsv(datasetId, name, select, '', cursor, options)) {
        yield { records: page.rows.map(map), cursor: page.cursor };
      }
    },
  });
  await mirror.runSync({ mode: 'init', ...(options.signal ? { signal: options.signal } : {}) });
}

/** Result of a {@link runMirrorInit} call. */
export interface MirrorInitResult {
  /** True when the full-corpus marker is present after this run. */
  full: boolean;
  /** States marked covered by this run (already-covered states are skipped). */
  statesIngested: string[];
  /** States already covered before this run. */
  statesSkipped: string[];
}

/** Options for {@link runMirrorInit}. */
export interface MirrorInitOptions extends IngestOptions {
  /** 2-digit state FIPS codes to ingest, or `'full'` for the whole corpus. */
  states: string[] | 'full';
  stores: Form477Stores;
}

/**
 * The one-time mirror bootstrap. Always drains the two small tables first
 * (geography lookup, provider summary — both cheap), then each target state
 * (deployment + area, marked covered once per state after both drain), and in
 * full mode the national area slice followed by the full-corpus marker.
 * Idempotent and resumable: covered states are skipped, an interrupted state
 * resumes from the persisted cursor or re-runs cleanly.
 */
export async function runMirrorInit(options: MirrorInitOptions): Promise<MirrorInitResult> {
  const { stores } = options;
  const full = options.states === 'full';
  const targets = full ? [...ALL_STATE_FIPS] : options.states;
  for (const fips of targets) {
    if (!isStateFips(fips)) {
      throw new Error(`Unknown state FIPS "${fips}". Valid codes: ${ALL_STATE_FIPS.join(', ')}.`);
    }
  }

  await runSmallTable(
    stores.geography,
    'fcc-477-geography',
    'v5vt-e7vw',
    GEOGRAPHY_SELECT,
    (r) => ({
      sid: requireSid(r, 'v5vt-e7vw'),
      geoid: r.geoid ?? '',
      type: r.type ?? '',
      name: r.name ?? '',
    }),
    options,
  );
  await runSmallTable(
    stores.providerSummary,
    'fcc-477-provider-summary',
    'yd9y-6jqe',
    PROVIDER_SUMMARY_SELECT,
    (r) => ({
      sid: requireSid(r, 'yd9y-6jqe'),
      hoconum: r.hoconum ?? '',
      tech: r.tech ?? '',
      d_1: r.d_1 ?? '',
      d_2: r.d_2 ?? '',
      d_3: r.d_3 ?? '',
      d_4: r.d_4 ?? '',
      d_5: r.d_5 ?? '',
      d_6: r.d_6 ?? '',
      d_7: r.d_7 ?? '',
      d_8: r.d_8 ?? '',
    }),
    options,
  );

  const statesIngested: string[] = [];
  const statesSkipped: string[] = [];
  for (const fips of targets) {
    options.signal?.throwIfAborted();
    if (await isCovered(stores.deployment, stateScope(fips))) {
      statesSkipped.push(fips);
      continue;
    }
    options.log?.info?.('Ingesting state', { fips, abbr: STATE_FIPS_TO_ABBR[fips] });
    await runDeploymentState(stores, fips, options);
    await runAreaScope(stores, stateScope(fips), options);
    // Coverage mark: once per state, only after both tables fully drained.
    await markCovered(stores.deployment, stateScope(fips));
    statesIngested.push(fips);
  }

  let fullMarked = await isCovered(stores.deployment, FULL_SCOPE);
  if (full && !fullMarked) {
    await runAreaScope(stores, NATIONAL_AREA_SCOPE, options);
    await markCovered(stores.deployment, FULL_SCOPE);
    fullMarked = true;
  }

  return { full: fullMarked, statesIngested, statesSkipped };
}
