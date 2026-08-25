/**
 * @fileoverview Surface-wide guard on strict tool inputs (mcp-ts-core 0.12.0).
 * `tool()` strictens every input root, so an undeclared argument key is rejected
 * by name instead of silently stripped, and the advertised `inputSchema` carries
 * `additionalProperties: false` to match. A definition that later re-opened its
 * root — via `.passthrough()` or `.catchall()` — would strip a caller's
 * misspelled key back into a wrong answer they cannot detect, so the whole tool
 * surface is asserted here rather than tool by tool.
 * @module tests/tools/strict-inputs.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { describe, expect, it } from 'vitest';
import { allToolDefinitions } from '@/mcp-server/tools/definitions/index.js';

/**
 * Minimal accepted arguments per tool — required fields only, letting every
 * defaulted and optional field fall through. Keyed by tool name so a renamed or
 * newly added tool fails the coverage assertion below rather than silently
 * skipping its strictness check.
 */
const MINIMAL_VALID_INPUT: Record<string, Record<string, unknown>> = {
  fcc_geocode_block: { latitude: 47.6062, longitude: -122.3321 },
  fcc_search_availability: { block_fips: '530330081002024' },
  fcc_get_coverage_summary: { geography_type: 'state', geography_id: '53' },
  fcc_search_providers: {},
  fcc_get_provider: { hoconum: '130317' },
  fcc_compare_areas: { geography_type: 'state', geography_ids: ['53', '06'] },
  fcc_find_underserved: {},
  fcc_list_filing_periods: {},
  fcc_list_downloads: { as_of_date: '2024-06-30' },
};

describe('strict tool inputs', () => {
  it('covers every registered tool', () => {
    expect(allToolDefinitions.map((t) => t.name).sort()).toEqual(
      Object.keys(MINIMAL_VALID_INPUT).sort(),
    );
  });

  describe.each(allToolDefinitions.map((t) => [t.name, t] as const))('%s', (name, toolDef) => {
    const valid = MINIMAL_VALID_INPUT[name] ?? {};

    it('accepts its minimal declared arguments', () => {
      expect(toolDef.input.safeParse(valid).success).toBe(true);
    });

    it('rejects an undeclared argument key by name', () => {
      const result = toolDef.input.safeParse({ ...valid, not_a_real_key: 'x' });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(JSON.stringify(result.error.issues)).toContain('not_a_real_key');
    });

    it('advertises additionalProperties: false', () => {
      const schema = z.toJSONSchema(toolDef.input as never, { io: 'input' }) as Record<
        string,
        unknown
      >;
      expect(schema.additionalProperties).toBe(false);
    });
  });
});
