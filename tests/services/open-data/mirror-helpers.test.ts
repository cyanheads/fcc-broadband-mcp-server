/**
 * @fileoverview Unit tests for the mirror's pure helpers: the RFC 4180 CSV
 * parser used on Socrata export pages, the GEOID prefix → range upper bound,
 * and the FTS5 phrase-prefix translation for provider name search.
 * @module tests/services/open-data/mirror-helpers.test
 */

import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/services/open-data/mirror/csv.js';
import { ftsPrefixQuery } from '@/services/open-data/mirror/form477-mirror.js';
import { prefixUpperBound } from '@/services/open-data/mirror/state-fips.js';

describe('parseCsv', () => {
  it('parses a quoted Socrata export page into keyed records', () => {
    const text =
      '"sid","blockcode","holdingcompanyname"\n' +
      '"row-1","110010001011000","Comcast Corporation"\r\n' +
      '"row-2","110010001011001","AT&T, Inc."\n';
    expect(parseCsv(text)).toEqual([
      { sid: 'row-1', blockcode: '110010001011000', holdingcompanyname: 'Comcast Corporation' },
      { sid: 'row-2', blockcode: '110010001011001', holdingcompanyname: 'AT&T, Inc.' },
    ]);
  });

  it('handles escaped quotes, embedded newlines, and unquoted fields', () => {
    const text = 'a,b\n"say ""hi""","line1\nline2"\nplain,3\n';
    expect(parseCsv(text)).toEqual([
      { a: 'say "hi"', b: 'line1\nline2' },
      { a: 'plain', b: '3' },
    ]);
  });

  it('returns [] for a header-only page and throws on an unterminated quote', () => {
    expect(parseCsv('"sid","blockcode"\n')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
    expect(() => parseCsv('a,b\n"unterminated,x')).toThrow('unterminated');
  });
});

describe('prefixUpperBound', () => {
  it('increments the last digit for the common case', () => {
    expect(prefixUpperBound('11')).toBe('12');
    expect(prefixUpperBound('53')).toBe('54');
    expect(prefixUpperBound('78')).toBe('79');
  });

  it('carries across trailing nines', () => {
    expect(prefixUpperBound('09')).toBe('1');
    expect(prefixUpperBound('19')).toBe('2');
    expect(prefixUpperBound('99')).toBe(':');
  });

  it('bounds match LIKE-prefix semantics over digit GEOIDs', () => {
    const inRange = (id: string, prefix: string) => id >= prefix && id < prefixUpperBound(prefix);
    expect(inRange('11001', '11')).toBe(true);
    expect(inRange('1150000', '11')).toBe(true); // 7-digit place GEOID
    expect(inRange('1101', '11')).toBe(true); // 4-digit cd GEOID
    expect(inRange('12001', '11')).toBe(false);
    expect(inRange('0950000', '09')).toBe(true);
    expect(inRange('10001', '09')).toBe(false);
  });
});

describe('ftsPrefixQuery', () => {
  it('translates tokens to quoted phrase-prefix terms', () => {
    expect(ftsPrefixQuery('Comcast')).toBe('"Comcast"*');
    expect(ftsPrefixQuery('comcast cable')).toBe('"comcast"* "cable"*');
  });

  it('strips punctuation and returns undefined for token-less input', () => {
    expect(ftsPrefixQuery('AT&T, Inc.')).toBe('"AT"* "T"* "Inc"*');
    expect(ftsPrefixQuery('%%%')).toBeUndefined();
  });
});
