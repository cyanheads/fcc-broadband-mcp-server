/**
 * @fileoverview FCC underserved area finder — ranked list of areas by broadband gap.
 * @module mcp-server/tools/definitions/find-underserved.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  AREA_SPEED_DESCRIPTION,
  AREA_TECH_DESCRIPTION,
  AREA_TECH_FILTERS,
} from '@/services/open-data/area-filters.js';
import { STATE_ABBR_TO_FIPS } from '@/services/open-data/mirror/state-fips.js';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

export const findUnderservedTool = tool('fcc_find_underserved', {
  title: 'Find Underserved Areas',
  description:
    'Finds geographic areas with limited or no broadband coverage at a given speed threshold, ranked by unserved population. ' +
    'Supports historical population screening and broadband equity research; it cannot establish current BEAD eligibility or address service. ' +
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
        '2-letter USPS state or territory code (e.g., "WY", "MS", "PR") to limit scope. An unrecognized code is rejected, not ignored. Omit for nationwide search — returns top areas only.',
      ),
    geography_type: z
      .enum(['county', 'cd', 'place', 'cbsa'])
      .default('county')
      .describe(
        'Geographic granularity for historical population screening. "county" = county. "cd" = congressional district. "place" = census-designated place. "cbsa" = metro area.',
      ),
    speed_down: z
      .enum(['0.2', '4', '10', '25', '100', '250', '1000'])
      .default('25')
      .describe(AREA_SPEED_DESCRIPTION),
    tech_filter: z.enum(AREA_TECH_FILTERS).default('acfow').describe(AREA_TECH_DESCRIPTION),
    min_unserved_pop: z
      .number()
      .int()
      .min(0)
      .default(1)
      .describe(
        'Minimum population with no coverage to include. Defaults to 1, which keeps fully covered areas out of a ranking of underserved ones. Set to 0 to rank every area regardless of unserved population, or higher to drop small gaps (e.g., 500 keeps only areas with at least 500 unserved residents).',
      ),
    urban_rural_filter: z
      .enum(['all', 'R', 'U'])
      .default('R')
      .describe(
        'Defaults to rural ("R") — where underservice is most concentrated. Use "U" to find underserved urban areas (digital redlining research). Set to "all" for both.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Number of globally ranked matching areas to skip.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of areas to return, ranked by unserved population (descending).'),
  }),

  output: z.object({
    offset: z.number().describe('Number of ranked matching areas skipped.'),
    nextOffset: z.number().optional().describe('Next offset when another ranked page remains.'),
    areas: z
      .array(
        z
          .object({
            id: z.string().describe('FIPS GEOID of the geography.'),
            name: z
              .string()
              .optional()
              .describe('Human-readable geography name if resolved (e.g., "Pontotoc County, MS").'),
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
    scanTruncated: z
      .boolean()
      .optional()
      .describe(
        'True when the upstream row scan stopped at its ceiling before reaching the end of the matching data, so totalFound and the ranking cover only the portion that was scanned. Absent when the scan read every matching row.',
      ),
    scanRowCap: z
      .number()
      .optional()
      .describe(
        'Raw upstream row ceiling that bound the scan. Present only when scanTruncated is true.',
      ),
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
        'Guidance about the result set — how to broaden the filters when nothing matched, and how to narrow the query when the upstream scan hit its row ceiling. Absent when neither applies.',
      ),
  },

  /*
   * `format()` renders the domain output only — the framework mirrors this
   * block's fields into `content[]` afterwards, and that trailer is the sole
   * path by which a `content[]`-only client learns the ranking was capped or
   * the upstream scan stopped short. Left unconfigured each field renders under
   * its raw declared key (`**scanRowCap:** 50000`), which reads as debug output
   * next to the prose notice and prints a row count the table's own figures
   * would have grouped. These entries only relabel and reformat; the values
   * reaching `structuredContent` are untouched.
   */
  enrichmentTrailer: {
    totalFound: { label: 'Total matching areas' },
    truncated: { label: 'List truncated' },
    shown: { label: 'Areas shown' },
    cap: { label: 'Limit applied' },
    scanTruncated: { label: 'Upstream scan truncated' },
    scanRowCap: {
      // Only rendered when populated, which happens only alongside scanTruncated.
      render: (rowCap) => `**Scan row ceiling:** ${Number(rowCap).toLocaleString()}`,
    },
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

  /*
   * A filter set matching no area is a successful empty ranking carrying a
   * notice, not a failure, so no not-found reason is declared.
   */
  errors: [
    {
      reason: 'unknown_state',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The state input is two uppercase letters but is not a USPS state or territory abbreviation.',
      recovery:
        'Use a real two-letter USPS state or territory abbreviation such as "MS" or "PR", or omit state entirely to search nationwide.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_find_underserved', {
      state: input.state,
      geographyType: input.geography_type,
      speedDown: input.speed_down,
      urbanRuralFilter: input.urban_rural_filter,
    });

    // A code the map doesn't know can't be turned into a filter, and dropping
    // it would answer a nationwide query the caller never asked for.
    const stateFipsPrefix = input.state ? STATE_ABBR_TO_FIPS.get(input.state) : undefined;
    if (input.state && stateFipsPrefix === undefined) {
      throw ctx.fail(
        'unknown_state',
        `"${input.state}" is not a USPS state or territory abbreviation.`,
      );
    }
    const service = getOpenDataService();
    const requestCtx = {
      ...ctx,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(48_000)]),
    };
    // The scan reads every matching row it can; the caller-facing `limit` trims
    // the ranked list afterwards and never bounds the data the ranking sees.
    const scan = await service.getAreaStatsByType(
      {
        geographyType: input.geography_type,
        techFilter: input.tech_filter,
        speedDown: input.speed_down,
        urbanRuralFilter: input.urban_rural_filter,
        ...(stateFipsPrefix !== undefined ? { stateFipsPrefix } : {}),
      },
      requestCtx,
    );

    const filtered = scan.stats.filter((s) => s.noCoverage >= input.min_unserved_pop);

    // Sort by unserved population descending
    filtered.sort((a, b) => b.noCoverage - a.noCoverage || a.id.localeCompare(b.id));

    const totalFound = filtered.length;
    const limited = filtered.slice(input.offset, input.offset + input.limit);
    const nextOffset =
      input.offset + limited.length < totalFound ? input.offset + limited.length : undefined;

    const appliedFilters = {
      ...(input.state && { state: input.state }),
      geographyType: input.geography_type,
      speedDownMbps: parseFloat(input.speed_down),
      techFilter: input.tech_filter,
      urbanRuralFilter: input.urban_rural_filter,
      minUnservedPop: input.min_unserved_pop,
    };
    ctx.enrich({
      totalFound,
      appliedFilters,
      ...(scan.scanTruncated && { scanTruncated: true, scanRowCap: scan.scanRowCap }),
    });

    /*
     * Every notice source lands in the single `notice` field (ctx.enrich.truncated
     * routes through it too, last-wins), so compose one string and emit it once.
     */
    const notices: string[] = [];
    const listTruncated = nextOffset !== undefined;
    if (listTruncated) {
      notices.push(
        `Showing ${input.offset === 0 ? 'the top ' : ''}${limited.length} of ${totalFound} matching areas. Continue with offset=${nextOffset} and the same filters.`,
      );
    }
    if (scan.scanTruncated) {
      notices.push(
        `The upstream scan stopped at its ${scan.scanRowCap.toLocaleString()}-row ceiling, so totalFound and this ranking cover only the rows that were read. Narrow the query with a state filter, a single urban_rural_filter, or a coarser geography_type.`,
      );
    }
    // Only reachable at min_unserved_pop 0, where a fully covered area still
    // ranks. Say so rather than let the tool name imply every row is a gap.
    const fullyCovered = limited.filter((s) => s.noCoverage === 0).length;
    if (fullyCovered > 0) {
      notices.push(
        `${fullyCovered} of the ${limited.length} returned areas have no unserved population at ${input.speed_down} Mbps — they are fully covered and rank only because min_unserved_pop is 0. Set min_unserved_pop to 1 to drop them, or raise speed_down to find gaps at a higher threshold.`,
      );
    }
    if (limited.length === 0 && totalFound > 0) {
      notices.push(
        `This page is exhausted at offset=${input.offset}; ${totalFound} areas matched the filters.`,
      );
    } else if (limited.length === 0) {
      notices.push(
        `No areas found with the current filters. Try lowering min_unserved_pop or setting urban_rural_filter to "all".${
          input.state !== undefined ? ` Dropping state="${input.state}" searches nationwide.` : ''
        }`,
      );
    }
    const notice = notices.join(' ');
    if (listTruncated) {
      ctx.enrich.truncated({ shown: limited.length, cap: input.limit, guidance: notice });
    } else if (notice) {
      ctx.enrich.notice(notice);
    }

    if (limited.length === 0) {
      return {
        offset: input.offset,
        areas: [],
        geographyType: input.geography_type,
        speedDownMbps: parseFloat(input.speed_down),
        urbanRuralFilter: input.urban_rural_filter,
        dataVintage: 'June 2021 (last Form 477 filing period)',
      };
    }

    /** Resolve names only after ranking and limiting; unavailable names may be omitted, but caller cancellation ends the call. */
    const names = await service
      .getGeographyNames(
        input.geography_type,
        limited.map((s) => s.id),
        requestCtx,
      )
      .catch((error: unknown) => {
        if (ctx.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
          throw error;
        return new Map<string, string>();
      });

    const areas = limited.map((s, i) => {
      const coveragePct = s.total > 0 ? ((s.total - s.noCoverage) / s.total) * 100 : 0;
      const unservedPct = s.total > 0 ? (s.noCoverage / s.total) * 100 : 0;
      const name = names.get(s.id);
      return {
        id: s.id,
        ...(name && { name }),
        rank: input.offset + i + 1,
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
      offset: input.offset,
      ...(nextOffset !== undefined && { nextOffset }),
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
      `**Offset:** ${result.offset}`,
      ...(result.nextOffset !== undefined ? [`**Next offset:** ${result.nextOffset}`] : []),
    ];

    if (result.areas.length === 0) {
      lines.push(
        result.offset > 0
          ? '\nThis page is exhausted.'
          : '\nNo underserved areas found with current filters.',
      );
    } else {
      lines.push(
        '',
        `| Rank | Name (GEOID) | Total Pop | No Coverage | 1 Provider | Unserved% | Coverage% |`,
      );
      lines.push(
        `|:-----|:-------------|:----------|:------------|:-----------|:----------|:----------|`,
      );
      for (const a of result.areas) {
        const geoLabel = a.name ? `${a.name} (${a.id})` : a.id;
        lines.push(
          `| ${a.rank} | ${geoLabel} | ${a.total.toLocaleString()} | ${a.noCoverage.toLocaleString()} | ${a.oneProvider.toLocaleString()} | ${a.unservedPct}% | ${a.coveragePct}% |`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
