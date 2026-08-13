/**
 * @fileoverview Types for the FCC BDC Public Data API service.
 * @module services/bdc-api/types
 */

/** BDC API response envelope. */
export interface BdcApiEnvelope<T> {
  data: T;
  message?: string;
  result_count?: number;
  status: string;
  status_code: number;
}

/** A filing date entry from /listAsOfDates. */
export interface BdcAsOfDate {
  as_of_date: string;
  publication_date?: string;
}

/** A file entry from /downloads/listAvailabilityData or /downloads/listChallengeData. */
export interface BdcDownloadFile {
  as_of_date?: string;
  category?: string;
  download_url?: string;
  file_id?: string;
  file_name?: string;
  file_size?: number;
  id?: string;
  name?: string;
  provider_id?: string;
  provider_name?: string;
  record_count?: number;
  state_abbr?: string;
  state_name?: string;
  subcategory?: string;
  technology_type?: string;
  url?: string;
}

/** Normalized filing period entry. */
export interface FilingPeriod {
  asOfDate: string;
  publicationDate?: string;
  source: 'form477' | 'bdc';
}

/** Normalized download file entry. */
export interface DownloadFile {
  asOfDate: string;
  category: string;
  downloadUrl: string;
  fileId: string;
  fileName: string;
  fileSizeBytes?: number;
  providerName?: string;
  recordCount?: number;
  stateAbbr?: string;
  stateName?: string;
  subcategory?: string;
  technologyType?: string;
}

/**
 * First as-of date the Broadband Data Collection covers. Anything earlier is a
 * Form 477 filing period, served by the Open Data tools rather than the BDC
 * download manifests, so a date below this is rejected without credentials or a
 * network call. Which dates BDC has published *since* is only knowable from the
 * credentialed `/listAsOfDates` endpoint.
 */
export const BDC_FIRST_AS_OF_DATE = '2022-06-30';

/** Hardcoded Form 477 filing periods (Jun 2015 – Jun 2021). */
export const FORM477_PERIODS: FilingPeriod[] = [
  { asOfDate: '2021-06-30', source: 'form477' },
  { asOfDate: '2020-12-31', source: 'form477' },
  { asOfDate: '2020-06-30', source: 'form477' },
  { asOfDate: '2019-12-31', source: 'form477' },
  { asOfDate: '2019-06-30', source: 'form477' },
  { asOfDate: '2018-12-31', source: 'form477' },
  { asOfDate: '2018-06-30', source: 'form477' },
  { asOfDate: '2017-12-31', source: 'form477' },
  { asOfDate: '2017-06-30', source: 'form477' },
  { asOfDate: '2016-12-31', source: 'form477' },
  { asOfDate: '2016-06-30', source: 'form477' },
  { asOfDate: '2015-12-31', source: 'form477' },
  { asOfDate: '2015-06-30', source: 'form477' },
];
