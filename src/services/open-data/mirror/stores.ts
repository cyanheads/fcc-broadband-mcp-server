/**
 * @fileoverview SQLite store declarations for the Form 477 mirror — one
 * `sqliteMirrorStore` per corpus table plus a derived provider-dimension store,
 * each in its own database file under the mirror directory (the framework's
 * `mirror_sync_state` is a single-row table per file, so stores cannot share
 * one). Also owns the `mirror_coverage` bookkeeping table (which state-scoped
 * ingest units have fully drained, plus the full-corpus marker), which lives in
 * the deployment database and is created via idempotent DDL on the raw handle
 * (framework migrations do not run on fresh databases, so aux DDL cannot ride
 * them).
 * @module services/open-data/mirror/stores
 */

import { join } from 'node:path';
import {
  type MirrorStore,
  type SqliteHandle,
  sqliteMirrorStore,
} from '@cyanheads/mcp-ts-core/mirror';

/** The five stores backing the Form 477 mirror. */
export interface Form477Stores {
  /** Area summary rows (xvwq-qtaj). */
  area: MirrorStore;
  /** Block-level deployment rows (jdr4-3q4p) — also hosts `mirror_coverage`. */
  deployment: MirrorStore;
  /** Geography lookup rows (v5vt-e7vw). */
  geography: MirrorStore;
  /**
   * Derived provider dimension: distinct hoconum × holdingcompanyname ×
   * stateabbr × techcode combos from the deployment table, populated during
   * deployment ingest. FTS5 over the holding-company name serves
   * `searchProviders`; only valid under the full-corpus marker.
   */
  providerDim: MirrorStore;
  /** Provider summary rows (yd9y-6jqe). */
  providerSummary: MirrorStore;
}

/** Create the five mirror stores rooted at `dir`. Nothing opens until first use. */
export function createForm477Stores(dir: string): Form477Stores {
  return {
    deployment: sqliteMirrorStore({
      path: join(dir, 'deployment.sqlite'),
      table: 'deployment',
      primaryKey: 'sid',
      columns: {
        sid: 'TEXT',
        blockcode: 'TEXT',
        provider_id: 'TEXT',
        providername: 'TEXT',
        holdingcompanyname: 'TEXT',
        hoconum: 'TEXT',
        stateabbr: 'TEXT',
        techcode: 'TEXT',
        // REAL so `maxaddown >= minSpeedDown` compares numerically.
        maxaddown: 'REAL',
        maxadup: 'REAL',
        consumer: 'TEXT',
        business: 'TEXT',
      },
      indexes: [{ columns: ['blockcode'] }],
    }),
    area: sqliteMirrorStore({
      path: join(dir, 'area.sqlite'),
      table: 'area',
      primaryKey: 'sid',
      columns: {
        sid: 'TEXT',
        type: 'TEXT',
        id: 'TEXT',
        tech: 'TEXT',
        speed: 'TEXT',
        urban_rural: 'TEXT',
        tribal_non: 'TEXT',
        has_0: 'TEXT',
        has_1: 'TEXT',
        has_2: 'TEXT',
        has_3more: 'TEXT',
      },
      indexes: [{ columns: ['type', 'tech', 'speed', 'id'] }],
    }),
    providerSummary: sqliteMirrorStore({
      path: join(dir, 'provider-summary.sqlite'),
      table: 'provider_summary',
      primaryKey: 'sid',
      columns: {
        sid: 'TEXT',
        hoconum: 'TEXT',
        tech: 'TEXT',
        d_1: 'TEXT',
        d_2: 'TEXT',
        d_3: 'TEXT',
        d_4: 'TEXT',
        d_5: 'TEXT',
        d_6: 'TEXT',
        d_7: 'TEXT',
        d_8: 'TEXT',
      },
      indexes: [{ columns: ['hoconum'] }],
    }),
    geography: sqliteMirrorStore({
      path: join(dir, 'geography.sqlite'),
      table: 'geography',
      primaryKey: 'sid',
      columns: {
        sid: 'TEXT',
        geoid: 'TEXT',
        type: 'TEXT',
        name: 'TEXT',
      },
      indexes: [{ columns: ['type', 'geoid'] }],
    }),
    providerDim: sqliteMirrorStore({
      path: join(dir, 'providers.sqlite'),
      table: 'provider_dim',
      primaryKey: 'combo',
      columns: {
        combo: 'TEXT',
        hoconum: 'TEXT',
        holdingcompanyname: 'TEXT',
        stateabbr: 'TEXT',
        techcode: 'TEXT',
      },
      fts: ['holdingcompanyname'],
      indexes: [{ columns: ['hoconum'] }],
    }),
  };
}

/** Close every store in the set. */
export async function closeForm477Stores(stores: Form477Stores): Promise<void> {
  await Promise.all([
    stores.deployment.close(),
    stores.area.close(),
    stores.providerSummary.close(),
    stores.geography.close(),
    stores.providerDim.close(),
  ]);
}

// ---------------------------------------------------------------------------
// Coverage bookkeeping (in deployment.sqlite)
// ---------------------------------------------------------------------------

/** Coverage scope key for a fully-ingested state. */
export function stateScope(fips: string): string {
  return `state:${fips}`;
}

/** Coverage scope key for the full-corpus marker. */
export const FULL_SCOPE = 'full';

const ensured = new WeakSet<object>();

/** Idempotently create the coverage table on the deployment DB handle. */
function ensureCoverageTable(handle: SqliteHandle): void {
  if (ensured.has(handle)) return;
  handle.exec(
    `CREATE TABLE IF NOT EXISTS mirror_coverage (
       scope TEXT PRIMARY KEY NOT NULL,
       completed_at TEXT NOT NULL
     )`,
  );
  ensured.add(handle);
}

/**
 * Mark an ingest scope as fully drained. Written exactly once per scope, after
 * every table belonging to the scope has completed — never per-page — so an
 * interrupted ingest can never read as complete.
 */
export async function markCovered(deployment: MirrorStore, scope: string): Promise<void> {
  const handle = await deployment.raw();
  ensureCoverageTable(handle);
  handle
    .prepare(
      `INSERT INTO mirror_coverage(scope, completed_at) VALUES (?, ?)
       ON CONFLICT(scope) DO UPDATE SET completed_at = excluded.completed_at`,
    )
    .run(scope, new Date().toISOString());
}

/** Whether an ingest scope has been marked fully drained. */
export async function isCovered(deployment: MirrorStore, scope: string): Promise<boolean> {
  const handle = await deployment.raw();
  ensureCoverageTable(handle);
  // `!= null` — bun:sqlite returns null for no row where better-sqlite3
  // returns undefined; the shared handle type only guarantees "no row".
  const row = handle
    .prepare<{ scope: string }>(`SELECT scope FROM mirror_coverage WHERE scope = ?`)
    .get(scope);
  return row != null;
}

/** All coverage scopes currently marked, ascending. */
export async function listCovered(deployment: MirrorStore): Promise<string[]> {
  const handle = await deployment.raw();
  ensureCoverageTable(handle);
  return handle
    .prepare<{ scope: string }>(`SELECT scope FROM mirror_coverage ORDER BY scope`)
    .all()
    .map((r) => r.scope);
}
