/**
 * @fileoverview FCC coverage comparison across multiple geographies — ranked table.
 * @module mcp-server/tools/definitions/compare-areas.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';
import { geoidShapeError } from '@/services/open-data/types.js';

/** FIPS codes for all 50 states + DC. */
const ALL_STATE_FIPS = [
  '01',
  '02',
  '04',
  '05',
  '06',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '50',
  '51',
  '53',
  '54',
  '55',
  '56',
];

export const compareAreasTool = tool('fcc_compare_areas', {
  title: 'Compare Broadband Coverage Across Areas',
  description:
    'Compares broadband coverage metrics across multiple geographies of the same type and returns a ranked table sorted by unserved or underserved population. ' +
    'Answers "which counties in this state have the worst broadband access?" and drives BEAD funding prioritization. ' +
    'Provide up to 50 geography IDs, or set compare_all_states=true for all 50 states + DC. ' +
    'Data is from FCC Form 477 (as of June 2021).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    geography_type: z
      .enum(['state', 'county', 'cd', 'place', 'cbsa', 'tribal'])
      .describe(
        'Geographic level to compare. Must be uniform across all geographies in the comparison.',
      ),
    geography_ids: z
      .array(z.string())
      .min(2)
      .max(50)
      .optional()
      .describe(
        'Array of FIPS GEOIDs to compare (up to 50). For all 50 states, omit and set compare_all_states=true.',
      ),
    compare_all_states: z
      .boolean()
      .default(false)
      .describe(
        'When true, compares all 50 states + DC. Overrides geography_ids. Requires geography_type="state".',
      ),
    tech_filter: z
      .enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w'])
      .default('acfosw')
      .describe(
        'Technology filter. "acfosw" = any wired or fixed wireless. "f" = fiber only. "c" = cable only. "a" = DSL. "s" = satellite. "w" = fixed wireless.',
      ),
    speed_down: z
      .enum(['0.2', '4', '10', '25', '100', '250', '1000'])
      .default('25')
      .describe(
        'Download speed threshold in Mbps. 25 = FCC legacy standard. 100 = BEAD program standard.',
      ),
    sort_by: z
      .enum(['unserved_pct', 'unserved_pop', 'coverage_pct', 'competitive_pct'])
      .default('unserved_pct')
      .describe(
        '"unserved_pct" = share of population with no broadband (default). "unserved_pop" = raw headcount for BEAD funding. "coverage_pct" = share with any coverage. "competitive_pct" = share with 2+ providers.',
      ),
  }),

  output: z.object({
    geographyType: z.string().describe('Geography type compared.'),
    techFilter: z.string().describe('Technology filter applied.'),
    speedDownMbps: z.number().describe('Speed threshold in Mbps.'),
    sortBy: z.string().describe('Ranking field used.'),
    areas: z
      .array(
        z
          .object({
            id: z.string().describe('FIPS GEOID.'),
            name: z
              .string()
              .optional()
              .describe('Human-readable geography name if resolved (e.g., "Pontotoc County, MS").'),
            rank: z.number().describe('Rank in the sorted comparison (1 = worst/lowest).'),
            noCoverage: z.number().describe('Population with no providers at the given speed.'),
            oneProvider: z.number().describe('Population with exactly one provider.'),
            twoProviders: z.number().describe('Population with two providers.'),
            threeOrMore: z.number().describe('Population with three or more providers.'),
            total: z.number().describe('Total population.'),
            unservedPct: z.number().describe('Percentage with no coverage.'),
            coveragePct: z.number().describe('Percentage with at least one provider.'),
            competitivePct: z.number().describe('Percentage with two or more providers.'),
          })
          .describe('Coverage metrics for one geography in the comparison.'),
      )
      .describe('Ranked comparison of geographies by the selected sort field.'),
    totalAreas: z.number().describe('Total number of areas compared.'),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  // Agent-facing success-path context: applied filter echo.
  enrichment: {
    appliedFilters: z
      .object({
        geographyType: z.string().describe('Geographic level compared.'),
        techFilter: z.string().describe('Technology filter applied.'),
        speedDownMbps: z.number().describe('Download speed threshold in Mbps.'),
        sortBy: z.string().describe('Field used for ranking.'),
        areasCompared: z.number().describe('Total number of geographies compared.'),
      })
      .describe('Filters and parameters applied to this comparison.'),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) =>
        [
          `- **Geography:** ${filters.geographyType}`,
          `- **Tech filter:** ${filters.techFilter}`,
          `- **Speed threshold:** ${filters.speedDownMbps} Mbps`,
          `- **Sorted by:** ${filters.sortBy}`,
          `- **Areas compared:** ${filters.areasCompared}`,
        ].join('\n'),
    },
  },

  errors: [
    {
      reason: 'no_data_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No area table data found for any of the requested geography IDs.',
      recovery:
        'Verify FIPS codes match the geography_type. Check format: state=2 digits, county=5 digits, cd=4 digits.',
    },
    {
      reason: 'invalid_all_states_combo',
      code: JsonRpcErrorCode.ValidationError,
      when: 'compare_all_states=true used with geography_type other than "state".',
      recovery:
        'Set geography_type="state" when using compare_all_states=true, or provide specific geography_ids.',
    },
    {
      reason: 'missing_geography_ids',
      code: JsonRpcErrorCode.ValidationError,
      when: 'No geography_ids provided and compare_all_states is false.',
      recovery:
        'Provide at least 2 geography_ids, or set compare_all_states=true with geography_type="state".',
    },
    {
      reason: 'invalid_geography_id_shape',
      code: JsonRpcErrorCode.ValidationError,
      when: 'A geography_ids entry has a digit count that does not match the geography_type (state=2, county=5, cd=4, cbsa=5, place=7).',
      recovery:
        'Use the digit count the geography_type expects: state=2, county=5, cd=4, cbsa=5, place=7. A 5-digit county FIPS starts with its 2-digit state prefix.',
    },
  ],

  async handler(input, ctx) {
    if (input.compare_all_states && input.geography_type !== 'state') {
      throw ctx.fail(
        'invalid_all_states_combo',
        'compare_all_states=true requires geography_type="state"',
        { ...ctx.recoveryFor('invalid_all_states_combo') },
      );
    }

    const geoIds = input.compare_all_states ? ALL_STATE_FIPS : (input.geography_ids ?? []);

    if (geoIds.length < 2) {
      throw ctx.fail(
        'missing_geography_ids',
        'Provide at least 2 geography_ids to compare, or set compare_all_states=true.',
        { ...ctx.recoveryFor('missing_geography_ids') },
      );
    }

    for (const id of geoIds) {
      const shapeError = geoidShapeError(input.geography_type, id);
      if (shapeError) {
        throw ctx.fail('invalid_geography_id_shape', shapeError, {
          ...ctx.recoveryFor('invalid_geography_id_shape'),
        });
      }
    }

    ctx.log.info('fcc_compare_areas', {
      geographyType: input.geography_type,
      geoCount: geoIds.length,
      sortBy: input.sort_by,
    });

    const service = getOpenDataService();
    const stats = await service.getAreaStatsBatch(
      {
        geographyType: input.geography_type,
        geographyIds: geoIds,
        techFilter: input.tech_filter,
        speedDown: input.speed_down,
      },
      ctx,
    );

    if (stats.length === 0) {
      throw ctx.fail(
        'no_data_found',
        `No area data found for ${geoIds.length} ${input.geography_type} geography IDs`,
        { ...ctx.recoveryFor('no_data_found') },
      );
    }

    // Compute derived metrics and sort
    const enriched = stats.map((s) => {
      const coveragePct = s.total > 0 ? ((s.total - s.noCoverage) / s.total) * 100 : 0;
      const unservedPct = s.total > 0 ? (s.noCoverage / s.total) * 100 : 0;
      const competitivePct = s.total > 0 ? ((s.twoProviders + s.threeOrMore) / s.total) * 100 : 0;
      return {
        id: s.id,
        noCoverage: s.noCoverage,
        oneProvider: s.oneProvider,
        twoProviders: s.twoProviders,
        threeOrMore: s.threeOrMore,
        total: s.total,
        unservedPct: Math.round(unservedPct * 10) / 10,
        coveragePct: Math.round(coveragePct * 10) / 10,
        competitivePct: Math.round(competitivePct * 10) / 10,
      };
    });

    // Sort descending (worst first)
    const sorted = enriched.sort((a, b) => {
      switch (input.sort_by) {
        case 'unserved_pct':
          return b.unservedPct - a.unservedPct;
        case 'unserved_pop':
          return b.noCoverage - a.noCoverage;
        case 'coverage_pct':
          return b.coveragePct - a.coveragePct;
        case 'competitive_pct':
          return b.competitivePct - a.competitivePct;
        default:
          return b.unservedPct - a.unservedPct;
      }
    });

    // Resolve GEOIDs to names in one batched lookup; a resolution failure never fails the call.
    const names = await service
      .getGeographyNames(
        input.geography_type,
        sorted.map((s) => s.id),
        ctx,
      )
      .catch(() => new Map<string, string>());

    const areas = sorted.map((s, i) => {
      const name = names.get(s.id);
      return { ...s, ...(name && { name }), rank: i + 1 };
    });

    ctx.log.info('fcc_compare_areas succeeded', {
      areasCompared: areas.length,
      sortBy: input.sort_by,
    });

    ctx.enrich({
      appliedFilters: {
        geographyType: input.geography_type,
        techFilter: input.tech_filter,
        speedDownMbps: parseFloat(input.speed_down),
        sortBy: input.sort_by,
        areasCompared: areas.length,
      },
    });

    return {
      geographyType: input.geography_type,
      techFilter: input.tech_filter,
      speedDownMbps: parseFloat(input.speed_down),
      sortBy: input.sort_by,
      areas,
      totalAreas: areas.length,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const sortLabel: Record<string, string> = {
      unserved_pct: 'Unserved %',
      unserved_pop: 'Unserved Population',
      coverage_pct: 'Coverage %',
      competitive_pct: 'Competitive %',
    };

    const lines = [
      `## Broadband Coverage Comparison`,
      `**Geography Type:** ${result.geographyType} | **Tech:** ${result.techFilter} | **Speed:** ${result.speedDownMbps} Mbps | **Sorted By:** ${sortLabel[result.sortBy] ?? result.sortBy}`,
      `**Data Vintage:** ${result.dataVintage} | **Areas Compared:** ${result.totalAreas}`,
      '',
      `| Rank | Name (GEOID) | Total Pop | No Coverage | 1 Provider | 2 Providers | 3+ Providers | Unserved% | Coverage% | Competitive% |`,
      `|:-----|:-------------|:----------|:------------|:-----------|:------------|:-------------|:----------|:----------|:-------------|`,
    ];

    for (const a of result.areas) {
      const geoLabel = a.name ? `${a.name} (${a.id})` : a.id;
      lines.push(
        `| ${a.rank} | ${geoLabel} | ${a.total.toLocaleString()} | ${a.noCoverage.toLocaleString()} | ${a.oneProvider.toLocaleString()} | ${a.twoProviders.toLocaleString()} | ${a.threeOrMore.toLocaleString()} | ${a.unservedPct}% | ${a.coveragePct}% | ${a.competitivePct}% |`,
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
