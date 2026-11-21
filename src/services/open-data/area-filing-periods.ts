/**
 * @fileoverview Supported FCC Open Data Area Tables and their response vintages.
 * @module services/open-data/area-filing-periods
 */

import { z } from '@cyanheads/mcp-ts-core';

/** The only Area Table vintage served by the local mirror. */
export const LATEST_AREA_FILING_DATE = '2021-06-30';

/** Public Socrata Area Table IDs, newest filing first. June 2020 uses Status V2. */
export const AREA_TABLE_BY_DATE = {
  [LATEST_AREA_FILING_DATE]: 'xvwq-qtaj',
  '2020-12-31': 'ymd4-xaiz',
  '2020-06-30': 'wxit-5xtm',
  '2019-12-31': 'ws2a-amik',
  '2019-06-30': 'udcw-naqn',
  '2018-12-31': 'wucg-w9k9',
  '2018-06-30': 'cekp-f8tj',
  '2017-12-31': 'fnid-qg8r',
  '2017-06-30': 'yikn-7er3',
  '2016-12-31': 'xv2f-wqqz',
} as const;

export type AreaFilingDate = keyof typeof AREA_TABLE_BY_DATE;

/** The advertised input enum is derived from the dataset routing table. */
export const areaFilingDateInput = z
  .enum(Object.keys(AREA_TABLE_BY_DATE) as AreaFilingDate[])
  .default(LATEST_AREA_FILING_DATE)
  .describe(
    'Form 477 filing date in YYYY-MM-DD format. Defaults to June 2021. See fcc_list_filing_periods for supported dates.',
  );

/** Optional notice shared by the structured and text vintage fields. */
export const vintageNoticeOutput = z
  .string()
  .optional()
  .describe('Comparability caveat for dates before December 2020.');

/** Keeps the existing June 2021 label and flags the December 2020 discontinuity. */
export function areaVintage(asOfDate: AreaFilingDate) {
  return {
    dataVintage:
      asOfDate === LATEST_AREA_FILING_DATE ? 'June 2021 (last Form 477 filing period)' : asOfDate,
    ...(asOfDate < '2020-12-31' && {
      vintageNotice:
        'The Form 477 Area Table series has a discontinuity at December 2020. Differences across that boundary cannot be attributed to coverage change alone.',
    }),
  };
}
