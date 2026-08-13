/**
 * @fileoverview Types for the FCC Open Data (Socrata) service.
 * @module services/open-data/types
 */

/** Dataset IDs on opendata.fcc.gov for Form 477 data. */
export const DATASET_IDS = {
  /** Block-level deployment: provider × block × technology × speed (Jun 2021) */
  DEPLOYMENT: 'jdr4-3q4p',
  /** Area table: population by provider-count × speed tier × urban/rural × tribal (Jun 2021) */
  AREA_TABLE: 'xvwq-qtaj',
  /** Provider summary table: national totals by tech × speed tier (Jun 2021) */
  PROVIDER_SUMMARY: 'yd9y-6jqe',
  /** Geography lookup: GEOID → name, centroid, bounding box */
  GEOGRAPHY_LOOKUP: 'v5vt-e7vw',
} as const;

/**
 * Expected FIPS GEOID digit length per geography type. Single source for the
 * shape rules so the tools sharing geoidShapeError cannot drift. `nation` (no
 * ID) and `tribal` (heterogeneous BIA area IDs) are deliberately absent.
 */
const GEOID_DIGIT_LENGTHS: Record<string, number> = {
  state: 2,
  county: 5,
  cd: 4,
  cbsa: 5,
  place: 7,
};

/**
 * Validates a GEOID's shape against its geography type. Returns a targeted,
 * correction-bearing message on mismatch, or undefined when the shape is valid
 * or the type has no shape rule (`nation`, `tribal`). Does not verify the
 * GEOID exists — existence stays an upstream lookup concern.
 */
export function geoidShapeError(geographyType: string, geographyId: string): string | undefined {
  const expected = GEOID_DIGIT_LENGTHS[geographyType];
  if (expected === undefined) return;
  if (geographyId.length === expected && /^\d+$/.test(geographyId)) return;
  if (geographyType === 'state' && /^\d{5}$/.test(geographyId)) {
    return `geography_id "${geographyId}" is 5 digits — that's a county FIPS. For geography_type="state" use the 2-digit state prefix ("${geographyId.slice(0, 2)}"), or set geography_type="county".`;
  }
  const actual = /^\d+$/.test(geographyId)
    ? `is ${geographyId.length} digits`
    : 'is not all digits';
  return `geography_id "${geographyId}" ${actual} — geography_type="${geographyType}" expects a ${expected}-digit FIPS GEOID.`;
}

/** Raw row from the deployment table (jdr4-3q4p). Socrata returns all fields as strings. */
export interface RawDeploymentRow {
  blockcode?: string;
  business?: string;
  consumer?: string;
  frn?: string;
  hoconum?: string;
  holdingcompanyname?: string;
  maxaddown?: string;
  maxadup?: string;
  provider_id?: string;
  providername?: string;
  stateabbr?: string;
  techcode?: string;
}

/** Raw row from the area table (xvwq-qtaj). */
export interface RawAreaRow {
  has_0?: string;
  has_1?: string;
  has_2?: string;
  has_3more?: string;
  id?: string;
  speed?: string;
  tech?: string;
  tribal_non?: string;
  type?: string;
  urban_rural?: string;
}

/** Raw row from a grouped provider query on the deployment table. */
export interface RawProviderRow {
  hoconum?: string;
  holdingcompanyname?: string;
  stateabbr?: string;
  techcode?: string;
}

/**
 * Raw row from the provider summary table (yd9y-6jqe) — one row per holding
 * company × technology, `d_1`–`d_8` carrying the population covered at each
 * download speed tier. The table has no holding-company name column; resolve
 * names from the deployment table.
 */
export interface RawProviderSummaryRow {
  d_1?: string;
  d_2?: string;
  d_3?: string;
  d_4?: string;
  d_5?: string;
  d_6?: string;
  d_7?: string;
  d_8?: string;
  hoconum?: string;
  /** Individual Form 477 technology code, or one of {@link PROVIDER_SUMMARY_ROLLUP_TECHS}. */
  tech?: string;
}

/**
 * The `tech` values that roll several technologies together, per the dataset's
 * own column definition: "all = any type; adsl = 10, 11, 12; cable = 40, 41,
 * 42, 43; other = 0, 20, 30, 90". Each one overlaps the individual technology
 * rows beside it, so any total summed across rows counts the same covered
 * population several times over. `all` is the FCC's non-overlapping national
 * figure; the rest of the set exists to be excluded.
 */
export const PROVIDER_SUMMARY_ROLLUP_TECHS: ReadonlySet<string> = new Set([
  'all',
  'adsl',
  'cable',
  'other',
]);

/** Raw row from the geography lookup table (v5vt-e7vw). */
export interface RawGeographyRow {
  geoid?: string;
  name?: string;
  type?: string;
}

/** Normalized deployment record for fcc_search_availability. */
export interface DeploymentRecord {
  blockFips: string;
  business: boolean;
  consumer: boolean;
  hoconum: string;
  holdingCompanyName: string;
  maxDownloadMbps: number;
  maxUploadMbps: number;
  providerId: string;
  providerName: string;
  stateAbbr: string;
  techCode: string;
}

/** Population counts for one geography, summed across its area-table segments. */
export interface AreaStats {
  id: string;
  noCoverage: number;
  oneProvider: number;
  threeOrMore: number;
  total: number;
  twoProviders: number;
}

/**
 * Result of a type-wide area scan. `scanTruncated` says whether the raw row
 * read behind `stats` reached the end of the upstream match: when it is true
 * the stats cover only the rows that fit under `scanRowCap`, and any caller
 * ranking or counting them must disclose that rather than present a prefix as
 * the complete set.
 */
export interface AreaScanResult {
  scanRowCap: number;
  scanTruncated: boolean;
  stats: AreaStats[];
}

/** Normalized area summary for a geography × segment. */
export interface AreaSegment {
  coveragePct: number;
  population: {
    noCoverage: number;
    oneProvider: number;
    twoProviders: number;
    threeOrMore: number;
    total: number;
  };
  tribal: 'T' | 'N';
  unservedPct: number;
  urbanRural: 'R' | 'U';
}

/**
 * One holding company's complete national footprint — every state it filed
 * deployments in and every technology code it deployed, across the whole
 * Form 477 corpus rather than whatever rows a search window happened to read.
 * Both lists are sorted; a company with no deployment rows has two empty ones.
 */
export interface ProviderFootprint {
  states: string[];
  techs: string[];
}

/**
 * Normalized provider record for fcc_search_providers. `statesServed` and
 * `techCodes` are the company's whole national footprint, resolved per company
 * — never the subset a bounded search window happened to expose, and never
 * narrowed to the search's own state or technology filter.
 */
export interface ProviderRecord {
  hoconum: string;
  holdingCompanyName: string;
  statesServed: string[];
  techCodes: string[];
}

/**
 * Result of a provider search. `scanTruncated` says whether the raw row read
 * behind `providers` reached the end of the upstream match: when it is true the
 * search saw only the rows that fit under `scanRowCap`, so `providers` is a
 * sample of the holding companies matching the query and `matched` counts only
 * what that sample contained rather than the true number of matches. The sample
 * is of *which* companies come back; each one that does carries its complete
 * footprint.
 */
export interface ProviderSearchResult {
  /**
   * Distinct holding companies the scan found, before `limit` trimmed the
   * returned list. The true match count only when `scanTruncated` is false.
   */
  matched: number;
  providers: ProviderRecord[];
  scanRowCap: number;
  scanTruncated: boolean;
}

/** FCC Form 477 technology code labels. */
export const TECH_CODE_LABELS: Record<string, string> = {
  '10': 'DSL (ADSL)',
  '11': 'DSL (ADSL2)',
  '12': 'DSL (VDSL)',
  '40': 'Cable modem (standard)',
  '41': 'Cable modem (DOCSIS 3.0)',
  '42': 'Cable modem (DOCSIS 3.1)',
  '43': 'Cable modem (other)',
  '50': 'Fiber to premises',
  '60': 'Satellite',
  '70': 'Fixed wireless',
};

/**
 * Download speed thresholds for the provider summary's `d_1`–`d_8` columns, as
 * published in the dataset's own column descriptions (yd9y-6jqe).
 */
export const SPEED_TIER_LABELS: Record<string, string> = {
  d_1: '0.2 Mbps',
  d_2: '4 Mbps',
  d_3: '10 Mbps',
  d_4: '25 Mbps',
  d_5: '100 Mbps',
  d_6: '250 Mbps',
  d_7: '500 Mbps',
  d_8: '1000 Mbps',
};
