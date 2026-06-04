/**
 * @fileoverview FCC broadband coverage summary for a geography — population by provider count.
 * @module mcp-server/tools/definitions/get-coverage-summary.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

export const getCoverageSummaryTool = tool('fcc_get_coverage_summary', {
  title: 'Get Broadband Coverage Summary',
  description:
    'Returns a broadband coverage summary for a geography — population with zero, one, two, or three-plus providers at a given speed threshold, split by urban/rural and tribal/non-tribal segments. ' +
    'The primary tool for digital divide and equity analysis. ' +
    'Supports state, county, congressional district, census place, CBSA (metro area), tribal area, and national level. ' +
    'Data is from FCC Form 477 (as of June 2021). Use 100 Mbps as the speed threshold for BEAD program policy analysis.',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    geography_type: z
      .enum(['nation', 'state', 'county', 'cd', 'place', 'cbsa', 'tribal'])
      .describe(
        'Geographic aggregation level. "nation" = US-wide totals (geography_id not needed). "cd" = congressional district. "place" = census-designated place. "cbsa" = core-based statistical area (metro area). "tribal" = tribal land area.',
      ),
    geography_id: z
      .string()
      .optional()
      .describe(
        'FIPS GEOID for the geography. State: 2-digit (e.g., "06" for California). County: 5-digit (e.g., "06037" for LA County). Congressional district: 4-digit state+district (e.g., "0601"). CBSA: 5-digit code. Omit for nation-level queries.',
      ),
    tech_filter: z
      .enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w'])
      .default('acfosw')
      .describe(
        'Technology filter. "acfosw" = any wired or fixed wireless (recommended baseline). "f" = fiber only. "c" = cable only. "a" = ADSL/DSL only. "s" = satellite only. "w" = fixed wireless only. Mix letters for combinations, e.g., "fc" = fiber or cable.',
      ),
    speed_down: z
      .enum(['0.2', '4', '10', '25', '100', '250', '1000'])
      .default('25')
      .describe(
        'Minimum download speed threshold in Mbps. 25 = FCC legacy broadband definition. 100 = BEAD program standard (use this for current policy analysis). "0.2" = any service above 200 Kbps.',
      ),
    urban_rural_filter: z
      .enum(['all', 'R', 'U'])
      .default('all')
      .describe(
        'Filter to urban ("U") or rural ("R") areas only, or "all" for both combined. Rural breakdown is key for BEAD program analysis.',
      ),
    tribal_filter: z
      .enum(['all', 'T', 'N'])
      .default('all')
      .describe(
        'Filter to tribal ("T") or non-tribal ("N") areas. Use "T" to assess Native American connectivity gaps.',
      ),
  }),

  output: z.object({
    geography: z
      .object({
        type: z.string().describe('Geography type (e.g., "state").'),
        id: z.string().describe('FIPS GEOID (e.g., "06").'),
        name: z.string().optional().describe('Human-readable name if available.'),
      })
      .describe('The queried geography.'),
    techFilter: z.string().describe('Technology filter applied.'),
    speedDownMbps: z.number().describe('Download speed threshold used in Mbps.'),
    population: z
      .object({
        noCoverage: z
          .number()
          .describe('Population where zero providers offer service at the given speed.'),
        oneProvider: z
          .number()
          .describe('Population with exactly one provider — no competitive choice.'),
        twoProviders: z.number().describe('Population with exactly two providers.'),
        threeOrMore: z.number().describe('Population with three or more providers.'),
        total: z.number().describe('Total population in the geography.'),
      })
      .describe('Population counts by provider availability tier.'),
    coveragePct: z
      .number()
      .describe('Percentage of population with at least one provider at the given speed.'),
    unservedPct: z.number().describe('Percentage with zero providers — FCC "unserved" definition.'),
    competitivePct: z.number().describe('Percentage with two or more providers.'),
    breakdown: z
      .array(
        z
          .object({
            urbanRural: z.enum(['R', 'U']).describe('"R" = rural, "U" = urban.'),
            tribal: z.enum(['T', 'N']).describe('"T" = tribal land, "N" = non-tribal.'),
            population: z
              .object({
                noCoverage: z.number().describe('Population with no coverage in this segment.'),
                oneProvider: z.number().describe('Population with one provider in this segment.'),
                twoProviders: z.number().describe('Population with two providers in this segment.'),
                threeOrMore: z
                  .number()
                  .describe('Population with three or more providers in this segment.'),
                total: z.number().describe('Total population in this segment.'),
              })
              .describe('Population breakdown for this urban/rural × tribal segment.'),
            coveragePct: z.number().describe('Coverage percentage for this segment.'),
            unservedPct: z.number().describe('Unserved percentage for this segment.'),
          })
          .describe('One urban/rural × tribal/non-tribal segment.'),
      )
      .describe('Per-segment breakdown by urban/rural and tribal/non-tribal.'),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  // Agent-facing success-path context: applied filter echo.
  // Reaches both structuredContent and content[] trailer without a format() entry.
  enrichment: {
    appliedFilters: z
      .object({
        geographyType: z.string().describe('Geographic aggregation level queried.'),
        geographyId: z.string().optional().describe('FIPS GEOID queried. Absent for nation-level.'),
        techFilter: z.string().describe('Technology filter applied.'),
        speedDownMbps: z.number().describe('Download speed threshold in Mbps.'),
        urbanRuralFilter: z.string().describe('Urban/rural filter applied.'),
        tribalFilter: z.string().describe('Tribal/non-tribal filter applied.'),
      })
      .describe('Filters applied to this query.'),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const lines = [
          `- **Geography:** ${filters.geographyType}${filters.geographyId ? ` ${filters.geographyId}` : ''}`,
          `- **Tech filter:** ${filters.techFilter}`,
          `- **Speed threshold:** ${filters.speedDownMbps} Mbps`,
          `- **Area filter:** ${filters.urbanRuralFilter}`,
          `- **Tribal filter:** ${filters.tribalFilter}`,
        ];
        return `**Applied Filters:**\n${lines.join('\n')}`;
      },
    },
  },

  errors: [
    {
      reason: 'geography_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No area data found for the given geography ID and type.',
      recovery:
        'Check the FIPS code format for the geography type. State=2 digits, county=5 digits, congressional district=4 digits.',
    },
    {
      reason: 'invalid_geography_combo',
      code: JsonRpcErrorCode.ValidationError,
      when: 'geography_id is omitted for a non-nation type, or geography_type is "nation" but geography_id is provided.',
      recovery:
        'Omit geography_id for nation-level queries, or provide it for all other geography types.',
    },
  ],

  async handler(input, ctx) {
    // Validate geography_id requirement
    if (input.geography_type !== 'nation' && !input.geography_id) {
      throw ctx.fail(
        'invalid_geography_combo',
        `geography_id is required for geography_type="${input.geography_type}"`,
        { ...ctx.recoveryFor('invalid_geography_combo') },
      );
    }
    if (input.geography_type === 'nation' && input.geography_id) {
      throw ctx.fail(
        'invalid_geography_combo',
        'geography_id should be omitted for nation-level queries',
        { ...ctx.recoveryFor('invalid_geography_combo') },
      );
    }

    ctx.log.info('fcc_get_coverage_summary', {
      type: input.geography_type,
      id: input.geography_id,
    });

    const service = getOpenDataService();
    const [segments, geoName] = await Promise.all([
      service.getAreaSegments(
        {
          geographyType: input.geography_type,
          ...(input.geography_id !== undefined && { geographyId: input.geography_id }),
          techFilter: input.tech_filter,
          speedDown: input.speed_down,
          urbanRuralFilter: input.urban_rural_filter,
          tribalFilter: input.tribal_filter,
        },
        ctx,
      ),
      service
        .getGeographyName(input.geography_type, input.geography_id ?? '0', ctx)
        .catch(() => undefined),
    ]);

    const geographyId = input.geography_type === 'nation' ? '0' : (input.geography_id ?? '');

    if (segments.length === 0) {
      throw ctx.fail(
        'geography_not_found',
        `No area data found for geography type="${input.geography_type}", id="${geographyId}". Check the FIPS code format or try a different geography type.`,
        { ...ctx.recoveryFor('geography_not_found') },
      );
    }

    // Aggregate totals across all segments
    let totalNoCoverage = 0;
    let totalOne = 0;
    let totalTwo = 0;
    let totalThreePlus = 0;
    let totalPop = 0;

    for (const seg of segments) {
      totalNoCoverage += seg.population.noCoverage;
      totalOne += seg.population.oneProvider;
      totalTwo += seg.population.twoProviders;
      totalThreePlus += seg.population.threeOrMore;
      totalPop += seg.population.total;
    }

    const coveragePct = totalPop > 0 ? ((totalPop - totalNoCoverage) / totalPop) * 100 : 0;
    const unservedPct = totalPop > 0 ? (totalNoCoverage / totalPop) * 100 : 0;
    const competitivePct = totalPop > 0 ? ((totalTwo + totalThreePlus) / totalPop) * 100 : 0;

    ctx.log.info('fcc_get_coverage_summary succeeded', {
      type: input.geography_type,
      id: geographyId,
      totalPop,
      unservedPct: unservedPct.toFixed(1),
    });

    ctx.enrich({
      appliedFilters: {
        geographyType: input.geography_type,
        ...(input.geography_id !== undefined && { geographyId: input.geography_id }),
        techFilter: input.tech_filter,
        speedDownMbps: parseFloat(input.speed_down),
        urbanRuralFilter: input.urban_rural_filter,
        tribalFilter: input.tribal_filter,
      },
    });

    return {
      geography: {
        type: input.geography_type,
        id: geographyId,
        ...(geoName && { name: geoName }),
      },
      techFilter: input.tech_filter,
      speedDownMbps: parseFloat(input.speed_down),
      population: {
        noCoverage: totalNoCoverage,
        oneProvider: totalOne,
        twoProviders: totalTwo,
        threeOrMore: totalThreePlus,
        total: totalPop,
      },
      coveragePct: Math.round(coveragePct * 10) / 10,
      unservedPct: Math.round(unservedPct * 10) / 10,
      competitivePct: Math.round(competitivePct * 10) / 10,
      breakdown: segments.map((seg) => ({
        urbanRural: seg.urbanRural,
        tribal: seg.tribal,
        population: {
          noCoverage: seg.population.noCoverage,
          oneProvider: seg.population.oneProvider,
          twoProviders: seg.population.twoProviders,
          threeOrMore: seg.population.threeOrMore,
          total: seg.population.total,
        },
        coveragePct: Math.round(seg.coveragePct * 10) / 10,
        unservedPct: Math.round(seg.unservedPct * 10) / 10,
      })),
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const geoLabel = result.geography.name
      ? `${result.geography.name} (${result.geography.type}=${result.geography.id})`
      : `${result.geography.type} ${result.geography.id}`;

    const lines = [
      `## Broadband Coverage Summary — ${geoLabel}`,
      `**Technology:** ${result.techFilter} | **Speed Threshold:** ${result.speedDownMbps} Mbps | **Data Vintage:** ${result.dataVintage}`,
      '',
      `### Population Overview`,
      `**Total Population:** ${result.population.total.toLocaleString()}`,
      `**Covered (≥1 provider):** ${result.coveragePct}% (${(result.population.total - result.population.noCoverage).toLocaleString()})`,
      `**Unserved (0 providers):** ${result.unservedPct}% (${result.population.noCoverage.toLocaleString()})`,
      `**Competitive (2+ providers):** ${result.competitivePct}% (${(result.population.twoProviders + result.population.threeOrMore).toLocaleString()})`,
      '',
      `| Tier | Population | Share |`,
      `|:-----|:-----------|:------|`,
      `| No coverage | ${result.population.noCoverage.toLocaleString()} | ${result.unservedPct}% |`,
      `| 1 provider | ${result.population.oneProvider.toLocaleString()} | ${result.population.total > 0 ? Math.round((result.population.oneProvider / result.population.total) * 1000) / 10 : 0}% |`,
      `| 2 providers | ${result.population.twoProviders.toLocaleString()} | ${result.population.total > 0 ? Math.round((result.population.twoProviders / result.population.total) * 1000) / 10 : 0}% |`,
      `| 3+ providers | ${result.population.threeOrMore.toLocaleString()} | ${result.population.total > 0 ? Math.round((result.population.threeOrMore / result.population.total) * 1000) / 10 : 0}% |`,
    ];

    if (result.breakdown.length > 0) {
      lines.push('', '### Segment Breakdown');
      lines.push(
        '| Urban/Rural | Tribal | Total Pop | No Coverage | 1 Provider | 2 Providers | 3+ Providers | Unserved% | Coverage% |',
      );
      lines.push(
        '|:------------|:-------|:----------|:------------|:-----------|:------------|:-------------|:----------|:---------|',
      );
      for (const seg of result.breakdown) {
        const urLabel = seg.urbanRural === 'R' ? 'Rural' : 'Urban';
        const tLabel = seg.tribal === 'T' ? 'Tribal' : 'Non-tribal';
        lines.push(
          `| ${urLabel} | ${tLabel} | ${seg.population.total.toLocaleString()} | ${seg.population.noCoverage.toLocaleString()} | ${seg.population.oneProvider.toLocaleString()} | ${seg.population.twoProviders.toLocaleString()} | ${seg.population.threeOrMore.toLocaleString()} | ${seg.unservedPct}% | ${seg.coveragePct}% |`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
