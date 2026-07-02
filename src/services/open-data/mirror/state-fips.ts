/**
 * @fileoverview State FIPS ↔ USPS abbreviation reference for the Form 477 mirror.
 * The mirror's ingest units and coverage gate are keyed by 2-digit state FIPS
 * (the first two digits of a census-block GEOID); the Socrata deployment table
 * is filtered by `stateabbr`, so both directions are needed. The 56 entries are
 * the exact roster present in the June 2021 Form 477 deployment table
 * (50 states + DC + AS/GU/MP/PR/VI), verified against the live dataset.
 * @module services/open-data/mirror/state-fips
 */

/** State FIPS → USPS abbreviation for every state in the Form 477 corpus. */
export const STATE_FIPS_TO_ABBR: Readonly<Record<string, string>> = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
  '60': 'AS',
  '66': 'GU',
  '69': 'MP',
  '72': 'PR',
  '78': 'VI',
};

/** All state FIPS codes in the corpus, ascending — the full-ingest roster. */
export const ALL_STATE_FIPS: readonly string[] = Object.keys(STATE_FIPS_TO_ABBR).sort();

/** Whether `fips` is a valid 2-digit state FIPS present in the corpus. */
export function isStateFips(fips: string): boolean {
  return Object.hasOwn(STATE_FIPS_TO_ABBR, fips);
}

/**
 * Geography types whose GEOID embeds the state FIPS as its first two digits
 * (state=2, cd=4, county=5, place=7 digits). `cbsa`, `tribal`, and `nation`
 * GEOIDs do not embed a state — those are only servable under full coverage.
 */
const STATE_EMBEDDED_TYPES = new Set(['state', 'county', 'cd', 'place']);

/** Whether a geography type's GEOID embeds the state FIPS as a prefix. */
export function typeEmbedsState(geographyType: string): boolean {
  return STATE_EMBEDDED_TYPES.has(geographyType);
}

/**
 * Exclusive lexicographic upper bound for an all-digits GEOID prefix — the
 * `[gte, lt)` pair replaces `id LIKE '<prefix>%'` over zero-padded fixed-width
 * GEOIDs (e.g. '11' → '12', '09' → '0:' would be wrong, so the last digit is
 * incremented with carry: '09' → '10', '19' → '20').
 */
export function prefixUpperBound(prefix: string): string {
  const digits = prefix.split('');
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i] as string;
    if (d !== '9') {
      digits[i] = String(Number(d) + 1);
      return digits.slice(0, i + 1).join('');
    }
    digits[i] = '0';
  }
  // All-nines prefix: '99' → ':' sorts above every digit string of any length.
  return ':';
}
