/**
 * @fileoverview Types for the FCC Geo API service.
 * @module services/geo-api/types
 */

/** Raw response from FCC Geo API `/api/census/block/find`. */
export interface GeoApiBlockResponse {
  Block?: {
    FIPS?: string;
    bbox?: number[];
  };
  County?: {
    FIPS?: string;
    name?: string;
  };
  executionTime?: string;
  isError?: boolean;
  messages?: string[];
  State?: {
    FIPS?: string;
    code?: string;
    name?: string;
  };
  status?: string;
}

/**
 * Normalized census block location result. The Area API does not echo the
 * census vintage it resolved against, so `censusVintage` records the year the
 * request pinned — the decennial census whose block boundaries `blockFips`
 * belongs to.
 */
export interface BlockLocation {
  blockFips: string;
  censusVintage: string;
  countyFips: string;
  countyName: string;
  stateCode: string;
  stateFips: string;
  stateName: string;
}
