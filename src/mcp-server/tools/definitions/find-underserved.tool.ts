/**
 * @fileoverview FCC underserved area finder — ranked list of areas by broadband gap.
 * @module mcp-server/tools/definitions/find-underserved.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

/** Maps 2-letter state abbreviations to 2-digit FIPS prefix for filtering county/cd/place IDs. */
const STATE_ABBR_TO_FIPS: Record<string, string> = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  DC: '11',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56',
};

export const findUnderservedTool = tool('fcc_find_underserved', {
  title: 'Find Underserved Areas',
  description:
    'Finds geographic areas with limited or no broadband coverage at a given speed threshold, ranked by unserved population. ' +
    'The core tool for BEAD program analysis and broadband equity research. ' +
    'Accepts a state abbreviation to narrow scope or runs nationwide. ' +
    'Defaults to rural areas where underservice is most concentrated. ' +
    'Data is from FCC Form 477 (as of June 2021).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe(
        '2-letter state code (e.g., "WY", "MS") to limit scope. Omit for nationwide search — returns top areas only.',
      ),
    geography_type: z
      .enum(['county', 'cd', 'place', 'cbsa'])
      .default('county')
      .describe(
        'Geographic granularity for results. "county" is most useful for policy analysis and BEAD eligibility. "cd" = congressional district. "place" = census-designated place. "cbsa" = metro area.',
      ),
    speed_down: z
      .enum(['0.2', '4', '10', '25', '100', '250', '1000'])
      .default('25')
      .describe(
        'Download speed threshold in Mbps for defining "underserved." 25 = FCC legacy standard. 100 = BEAD program standard.',
      ),
    tech_filter: z
      .enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w'])
      .default('acfosw')
      .describe(
        'Technology filter. "acfosw" = any wired or fixed wireless. "f" = fiber only. "c" = cable only.',
      ),
    min_unserved_pop: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Minimum population with no coverage to include. Use to filter out very small areas (e.g., 500 filters areas with fewer than 500 unserved residents).',
      ),
    urban_rural_filter: z
      .enum(['all', 'R', 'U'])
      .default('R')
      .describe(
        'Defaults to rural ("R") — where underservice is most concentrated. Use "U" to find underserved urban areas (digital redlining research). Set to "all" for both.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of areas to return, ranked by unserved population (descending).'),
  }),

  output: z.object({
    areas: z
      .array(
        z
          .object({
            id: z.string().describe('FIPS GEOID of the geography.'),
            rank: z.number().describe('Rank by unserved population (1 = most unserved).'),
            noCoverage: z
              .number()
              .describe('Population with zero providers at the given speed threshold.'),
            oneProvider: z.number().describe('Population with exactly one provider.'),
            total: z.number().describe('Total population in the geography.'),
            unservedPct: z.number().describe('Percentage of population with no coverage.'),
            coveragePct: z
              .number()
              .describe('Percentage of population with at least one provider.'),
          })
          .describe('An underserved area ranked by unserved population.'),
      )
      .describe('Ranked list of underserved areas.'),
    geographyType: z.string().describe('Geography type returned.'),
    speedDownMbps: z.number().describe('Speed threshold used in Mbps.'),
    urbanRuralFilter: z.string().describe('Urban/rural filter applied.'),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  // Agent-facing success-path context: result count, truncation disclosure, applied filter echo, and empty-result notice.
  enrichment: {
    totalFound: z
      .number()
      .describe('Total number of areas found before applying the limit filter.'),
    truncated: z
      .boolean()
      .optional()
      .describe('True when more areas matched than the limit returned. Absent when not truncated.'),
    shown: z
      .number()
      .optional()
      .describe('Number of areas returned after applying the limit. Present when truncated.'),
    cap: z.number().optional().describe('The limit that was applied. Present when truncated.'),
    appliedFilters: z
      .object({
        state: z
          .string()
          .optional()
          .describe('State abbreviation filter applied. Absent for nationwide searches.'),
        geographyType: z.string().describe('Geographic granularity queried.'),
        speedDownMbps: z.number().describe('Download speed threshold in Mbps.'),
        techFilter: z.string().describe('Technology filter applied.'),
        urbanRuralFilter: z.string().describe('Urban/rural filter applied.'),
        minUnservedPop: z.number().describe('Minimum unserved population filter applied.'),
      })
      .describe('Filters applied to this query.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when no areas are found — suggests how to broaden the filters. Absent on successful results.',
      ),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const lines = [
          `- **Geography:** ${filters.geographyType}`,
          `- **Speed threshold:** ${filters.speedDownMbps} Mbps`,
          `- **Tech filter:** ${filters.techFilter}`,
          `- **Area filter:** ${filters.urbanRuralFilter}`,
          `- **Min unserved pop:** ${filters.minUnservedPop}`,
        ];
        if (filters.state) lines.unshift(`- **State:** ${filters.state}`);
        return `**Applied Filters:**\n${lines.join('\n')}`;
      },
    },
  },

  errors: [
    {
      reason: 'no_areas_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No areas found matching the criteria after applying filters.',
      recovery:
        'Lower min_unserved_pop, change urban_rural_filter to "all", or remove the state filter to search nationwide.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_find_underserved', {
      state: input.state,
      geographyType: input.geography_type,
      speedDown: input.speed_down,
      urbanRuralFilter: input.urban_rural_filter,
    });

    const stateFipsPrefix = input.state ? STATE_ABBR_TO_FIPS[input.state] : undefined;
    const service = getOpenDataService();
    const stats = await service.getAreaStatsByType(
      {
        geographyType: input.geography_type,
        techFilter: input.tech_filter,
        speedDown: input.speed_down,
        urbanRuralFilter: input.urban_rural_filter,
        ...(stateFipsPrefix !== undefined ? { stateFipsPrefix } : {}),
        limit: 5000, // fetch enough to filter and rank
      },
      ctx,
    );

    const filtered = stats.filter((s) => s.noCoverage >= input.min_unserved_pop);

    // Sort by unserved population descending
    filtered.sort((a, b) => b.noCoverage - a.noCoverage);

    const totalFound = filtered.length;
    const limited = filtered.slice(0, input.limit);

    const appliedFilters = {
      ...(input.state && { state: input.state }),
      geographyType: input.geography_type,
      speedDownMbps: parseFloat(input.speed_down),
      techFilter: input.tech_filter,
      urbanRuralFilter: input.urban_rural_filter,
      minUnservedPop: input.min_unserved_pop,
    };
    ctx.enrich({ totalFound, appliedFilters });

    if (totalFound > input.limit) {
      ctx.enrich.truncated({ shown: limited.length, cap: input.limit });
    }

    if (limited.length === 0) {
      ctx.enrich.notice(
        `No areas found with the current filters. Try lowering min_unserved_pop or setting urban_rural_filter to "all".`,
      );
      return {
        areas: [],
        geographyType: input.geography_type,
        speedDownMbps: parseFloat(input.speed_down),
        urbanRuralFilter: input.urban_rural_filter,
        dataVintage: 'June 2021 (last Form 477 filing period)',
      };
    }

    const areas = limited.map((s, i) => {
      const coveragePct = s.total > 0 ? ((s.total - s.noCoverage) / s.total) * 100 : 0;
      const unservedPct = s.total > 0 ? (s.noCoverage / s.total) * 100 : 0;
      return {
        id: s.id,
        rank: i + 1,
        noCoverage: s.noCoverage,
        oneProvider: s.oneProvider,
        total: s.total,
        unservedPct: Math.round(unservedPct * 10) / 10,
        coveragePct: Math.round(coveragePct * 10) / 10,
      };
    });

    ctx.log.info('fcc_find_underserved succeeded', {
      totalFound,
      returned: areas.length,
    });

    return {
      areas,
      geographyType: input.geography_type,
      speedDownMbps: parseFloat(input.speed_down),
      urbanRuralFilter: input.urban_rural_filter,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const urLabel =
      result.urbanRuralFilter === 'R' ? 'Rural' : result.urbanRuralFilter === 'U' ? 'Urban' : 'All';

    const lines = [
      `## Underserved Areas — ${result.geographyType} level`,
      `**Speed Threshold:** ${result.speedDownMbps} Mbps | **Area Filter:** ${urLabel} (${result.urbanRuralFilter}) | **Data Vintage:** ${result.dataVintage}`,
      `**Shown:** ${result.areas.length}`,
    ];

    if (result.areas.length === 0) {
      lines.push('\nNo underserved areas found with current filters.');
    } else {
      lines.push(
        '',
        `| Rank | GEOID | Total Pop | No Coverage | 1 Provider | Unserved% | Coverage% |`,
      );
      lines.push(`|:-----|:------|:----------|:------------|:-----------|:----------|:----------|`);
      for (const a of result.areas) {
        lines.push(
          `| ${a.rank} | ${a.id} | ${a.total.toLocaleString()} | ${a.noCoverage.toLocaleString()} | ${a.oneProvider.toLocaleString()} | ${a.unservedPct}% | ${a.coveragePct}% |`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
