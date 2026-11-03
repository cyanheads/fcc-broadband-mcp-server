/**
 * @fileoverview Canonical Area Table filters and source-defined speed pair descriptions.
 * @module tests/services/open-data/area-filters.test
 */
import { describe, expect, it } from 'vitest';
import { compareAreasTool } from '@/mcp-server/tools/definitions/compare-areas.tool.js';
import { findUnderservedTool } from '@/mcp-server/tools/definitions/find-underserved.tool.js';
import { getCoverageSummaryTool } from '@/mcp-server/tools/definitions/get-coverage-summary.tool.js';
import { AREA_SPEED_DESCRIPTION, AREA_TECH_FILTERS } from '@/services/open-data/area-filters.js';

describe('Area Table filters', () => {
  it('accepts exactly all 63 nonempty alphabetical subsets of the six source letters', () => {
    const letters = ['a', 'c', 'f', 'o', 's', 'w'];
    const expected = Array.from({ length: 63 }, (_, index) =>
      letters.filter((_, bit) => ((index + 1) & (1 << bit)) !== 0).join(''),
    ).sort();
    expect([...AREA_TECH_FILTERS]).toEqual(expected);
    for (const tech of expected) {
      expect(
        getCoverageSummaryTool.input.safeParse({ geography_type: 'nation', tech_filter: tech })
          .success,
      ).toBe(true);
    }
    for (const tech of ['', 'fa', 'aa', 'x', '50', 'acfows']) {
      expect(
        getCoverageSummaryTool.input.safeParse({ geography_type: 'nation', tech_filter: tech })
          .success,
      ).toBe(false);
    }
  });

  it('preserves all old explicit technology values on every Area Table tool', () => {
    for (const tech_filter of ['acfosw', 'f', 'c', 'a', 'o', 's', 'w']) {
      expect(
        getCoverageSummaryTool.input.parse({ geography_type: 'nation', tech_filter }).tech_filter,
      ).toBe(tech_filter);
      expect(
        compareAreasTool.input.parse({
          geography_type: 'state',
          geography_ids: ['28', '01'],
          tech_filter,
        }).tech_filter,
      ).toBe(tech_filter);
      expect(findUnderservedTool.input.parse({ tech_filter }).tech_filter).toBe(tech_filter);
    }
  });

  it.each([
    '0.2=0.2/0.2',
    '4=4/1',
    '10=10/1',
    '25=25/3',
    '100=100/10',
    '250=250/25',
    '1000=1000/100',
  ])('describes the metadata pair %s', (pair) => {
    expect(AREA_SPEED_DESCRIPTION).toContain(pair);
  });
});
