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

/** Raw row from the provider summary table (yd9y-6jqe). */
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
  holdingcompanyname?: string;
  techcode?: string;
}

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

/** Normalized provider record for fcc_search_providers. */
export interface ProviderRecord {
  hoconum: string;
  holdingCompanyName: string;
  statesServed: string[];
  techCodes: string[];
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

/** Speed tier labels for provider summary — download tier indices d_1 to d_8. */
export const SPEED_TIER_LABELS: Record<string, string> = {
  d_1: '0.2 Mbps',
  d_2: '4 Mbps',
  d_3: '10 Mbps',
  d_4: '25 Mbps',
  d_5: '50 Mbps',
  d_6: '100 Mbps',
  d_7: '250 Mbps',
  d_8: '1000 Mbps',
};
