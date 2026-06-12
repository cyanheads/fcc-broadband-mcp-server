/**
 * @fileoverview FCC ISP search — finds holding companies by name, state, and technology.
 * @module mcp-server/tools/definitions/search-providers.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

export const searchProvidersTool = tool('fcc_search_providers', {
  title: 'Search Broadband Providers',
  description:
    'Searches for ISPs by holding company name, filtered by state and technology type. ' +
    'Returns a deduplicated list of matching providers with hoconum identifiers for follow-up calls to fcc_get_provider. ' +
    'Answers "which ISPs serve Washington with fiber?" and "find all Comcast entities." ' +
    'Geographic filtering is state-level; sub-state granularity requires cross-referencing block data. ' +
    'Data is from FCC Form 477 (as of June 2021).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    name_search: z
      .string()
      .optional()
      .describe(
        'Partial holding company name to search (case-insensitive). e.g., "Comcast", "T-Mobile", "Frontier". Omit to list all providers in a state.',
      ),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe(
        '2-letter state abbreviation (e.g., "WA") to limit results to providers serving that state.',
      ),
    tech_filter: z
      .array(z.enum(['10', '11', '12', '40', '41', '42', '43', '50', '60', '70']))
      .optional()
      .describe(
        'Technology codes to filter. 50=Fiber, 40–43=Cable, 10–12=DSL, 60=Satellite, 70=Fixed wireless. Omit for all technologies.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('Maximum number of distinct providers to return.'),
  }),

  output: z.object({
    providers: z
      .array(
        z
          .object({
            hoconum: z
              .string()
              .describe(
                'Holding company number — use with fcc_get_provider for a national profile.',
              ),
            holdingCompanyName: z.string().describe('Holding company name.'),
            statesServed: z
              .array(z.string().describe('State abbreviation (e.g., "WA").'))
              .describe('State abbreviations where this provider has reported filings.'),
            techCodes: z
              .array(z.string().describe('FCC technology code (e.g., "50" = fiber).'))
              .describe('Technology codes reported by this provider.'),
          })
          .describe('A deduplicated ISP holding company entry.'),
      )
      .describe('Matching providers, deduplicated by holding company.'),
    totalFound: z.number().describe('Number of distinct providers returned.'),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  // Agent-facing success-path context: truncation disclosure, applied filter echo, and empty-result notice.
  enrichment: {
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when results were capped at the limit and more providers may exist. Absent when not capped.',
      ),
    shown: z.number().optional().describe('Number of providers returned. Present when capped.'),
    cap: z.number().optional().describe('The limit that was applied. Present when capped.'),
    appliedFilters: z
      .object({
        nameSearch: z
          .string()
          .optional()
          .describe('Name fragment searched. Absent when no name search was used.'),
        state: z
          .string()
          .optional()
          .describe('State filter applied. Absent for nationwide searches.'),
        techFilter: z
          .array(z.string())
          .optional()
          .describe('Technology code filter applied. Absent when no tech filter was used.'),
      })
      .describe('Filters applied to this query.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when no providers are found — suggests how to broaden the search. Absent on successful results.',
      ),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const lines: string[] = [];
        if (filters.nameSearch) lines.push(`- **Name search:** "${filters.nameSearch}"`);
        if (filters.state) lines.push(`- **State:** ${filters.state}`);
        if (filters.techFilter?.length)
          lines.push(`- **Tech filter:** ${filters.techFilter.join(', ')}`);
        return lines.length > 0
          ? `**Applied Filters:**\n${lines.join('\n')}`
          : '**Applied Filters:** none';
      },
    },
  },

  errors: [
    {
      reason: 'no_providers_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No providers matched the search criteria.',
      recovery:
        'Try a shorter name fragment, remove state or technology filters, or verify state abbreviation is uppercase (e.g., "WA").',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_search_providers', {
      nameSearch: input.name_search,
      state: input.state,
      techFilter: input.tech_filter,
    });

    const service = getOpenDataService();
    const providers = await service.searchProviders(
      {
        ...(input.name_search !== undefined && { nameSearch: input.name_search }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.tech_filter?.length && { techCodes: input.tech_filter }),
        limit: input.limit,
      },
      ctx,
    );

    ctx.log.info('fcc_search_providers succeeded', { count: providers.length });

    const appliedFilters = {
      ...(input.name_search !== undefined && { nameSearch: input.name_search }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.tech_filter?.length && { techFilter: input.tech_filter }),
    };
    ctx.enrich({ appliedFilters });

    if (providers.length >= input.limit) {
      ctx.enrich.truncated({ shown: providers.length, cap: input.limit });
    }

    if (providers.length === 0) {
      const criteria = [
        input.name_search && `name="${input.name_search}"`,
        input.state && `state="${input.state}"`,
        input.tech_filter?.length && `tech codes=[${input.tech_filter.join(', ')}]`,
      ]
        .filter(Boolean)
        .join(', ');
      ctx.enrich.notice(
        `No providers matched ${criteria}. Try a shorter name fragment or remove filters.`,
      );
      return {
        providers: [],
        totalFound: 0,
        dataVintage: 'June 2021 (last Form 477 filing period)',
      };
    }

    return {
      providers,
      totalFound: providers.length,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const lines = [
      `## Broadband Providers`,
      `**Data Vintage:** ${result.dataVintage} | **Found:** ${result.totalFound}`,
    ];

    if (result.providers.length === 0) {
      lines.push('\nNo providers matched the search criteria.');
    } else {
      lines.push('');
      for (const p of result.providers) {
        lines.push(`### ${p.holdingCompanyName}`);
        lines.push(`**Hoconum:** ${p.hoconum}`);
        lines.push(`**States:** ${p.statesServed.join(', ') || 'N/A'}`);
        lines.push(`**Technologies:** ${p.techCodes.join(', ') || 'N/A'}`);
        lines.push('');
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
