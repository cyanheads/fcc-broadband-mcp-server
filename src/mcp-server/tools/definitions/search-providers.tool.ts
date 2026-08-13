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
    'Against the live FCC API the search reads a bounded window of deployment rows to find which holding companies match, so when scanTruncated comes back true the providers are a sample of the matches rather than every one of them and no true match count is available; a narrower filter raises the share of matches the sample surfaces but cannot make it complete, and only a deployment running the local Form 477 mirror returns every match. ' +
    'The sample is of which companies come back — every company that does carries its complete national footprint, since statesServed and techCodes are resolved per company rather than read off the window, at the cost of one lookup per provider returned. ' +
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
        '2-letter state abbreviation (e.g., "WA") to limit results to providers serving that state. Matches individual deployment filings, so every filter given must hold on one filing together — a provider is returned for state="WA" with tech_filter=["50"] only if it filed fiber in Washington, not if it filed fiber elsewhere and something else in Washington.',
      ),
    tech_filter: z
      .array(z.enum(['10', '11', '12', '40', '41', '42', '43', '50', '60', '70']))
      .optional()
      .describe(
        'Technology codes to filter. 50=Fiber, 40–43=Cable, 10–12=DSL, 60=Satellite, 70=Fixed wireless. Omit for all technologies. Matches individual deployment filings like state does, so pairing this with name_search narrows to filings made under the matched name — a holding company that files some technologies under an acquired brand name can come back empty here while its techCodes list the technology. To ask what one company deploys, search the name alone and read techCodes off the result.',
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
            holdingCompanyName: z
              .string()
              .describe(
                'Holding company name as filed on the deployment rows this search matched. One holding company number can carry more than one name in Form 477 — an acquired brand still filing under the parent number — and this is the name the matched rows carry, not necessarily every name filed under the number.',
              ),
            statesServed: z
              .array(z.string().describe('State abbreviation (e.g., "WA").'))
              .describe(
                'Every state, district, and territory this holding company filed deployments in nationally — its complete footprint, resolved per company. Not narrowed by the state filter, and complete even when the provider list is a sample.',
              ),
            techCodes: z
              .array(z.string().describe('FCC technology code (e.g., "50" = fiber).'))
              .describe(
                'Every technology code this holding company deployed nationally — its complete set, resolved per company. Not narrowed by tech_filter, and complete even when the provider list is a sample. Drawn from block-level deployment filings, so it can exceed the technologies fcc_get_provider reports, which counts only those with reported covered population.',
              ),
          })
          .describe('A deduplicated ISP holding company entry.'),
      )
      .describe('Matching providers, deduplicated by holding company.'),
    totalFound: z
      .number()
      .describe(
        'Providers in this response. Not the number matching the query — that is totalCount, and it is only knowable when the scan read every matching row.',
      ),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  // Agent-facing success-path context: sample and truncation disclosure, applied filter echo, and empty-result notice.
  enrichment: {
    totalCount: z
      .number()
      .optional()
      .describe(
        'Distinct providers matching the query, before the limit. Present only when the scan read every matching row — absent when scanTruncated is true, because the true match count is then unknown.',
      ),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when results were capped at the limit and more providers may exist. Absent when not capped.',
      ),
    shown: z.number().optional().describe('Number of providers returned. Present when capped.'),
    cap: z.number().optional().describe('The limit that was applied. Present when capped.'),
    scanTruncated: z
      .boolean()
      .optional()
      .describe(
        'True when the upstream row scan stopped at its ceiling before reaching the end of the matching data, so the providers returned are a sample of the matches rather than the complete set. Bounds which companies came back, not what each one reports — statesServed and techCodes are resolved per company and stay complete. Absent when the scan read every matching row.',
      ),
    scanRowCap: z
      .number()
      .optional()
      .describe(
        'Raw upstream row ceiling that bound the scan. Present only when scanTruncated is true.',
      ),
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
        'Guidance about the result set — that the list was capped at the limit, that the upstream scan returned a sample rather than every match, and how to broaden the search when nothing matched. Absent when none applies.',
      ),
  },

  /*
   * `format()` renders the domain output only — the framework mirrors this
   * block's fields into `content[]` afterwards, and that trailer is the sole
   * path by which a `content[]`-only client learns the provider list was capped
   * or that the upstream scan returned a sample. Left unconfigured each field
   * renders under its raw declared key (`**scanRowCap:** 1000`), which reads
   * as debug output next to the prose notice.
   */
  enrichmentTrailer: {
    truncated: { label: 'List truncated' },
    shown: { label: 'Providers shown' },
    cap: { label: 'Limit applied' },
    scanTruncated: { label: 'Upstream scan truncated' },
    scanRowCap: {
      // Only rendered when populated, which happens only alongside scanTruncated.
      render: (rowCap) => `**Scan row ceiling:** ${Number(rowCap).toLocaleString()}`,
    },
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
    {
      reason: 'live_search_timeout',
      code: JsonRpcErrorCode.Timeout,
      retryable: false,
      when: 'A live FCC Open Data provider search exceeded its 30-second budget, on either the bounded windowed read or one of the per-provider footprint lookups; both are shapes that answer in seconds or not at all, so a retry reaches the same result.',
      recovery:
        'FCC Open Data is not serving this search right now; try again later. Operators can enable the local Form 477 mirror (FCC_MIRROR_ENABLED=true) to search holding-company names locally.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_search_providers', {
      nameSearch: input.name_search,
      state: input.state,
      techFilter: input.tech_filter,
    });

    const service = getOpenDataService();
    const search = await service.searchProviders(
      {
        ...(input.name_search !== undefined && { nameSearch: input.name_search }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.tech_filter?.length && { techCodes: input.tech_filter }),
        limit: input.limit,
      },
      ctx,
    );
    const { providers } = search;

    ctx.log.info('fcc_search_providers succeeded', {
      count: providers.length,
      matched: search.matched,
      scanTruncated: search.scanTruncated,
    });

    const appliedFilters = {
      ...(input.name_search !== undefined && { nameSearch: input.name_search }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.tech_filter?.length && { techFilter: input.tech_filter }),
    };
    ctx.enrich({
      appliedFilters,
      ...(search.scanTruncated && { scanTruncated: true, scanRowCap: search.scanRowCap }),
    });
    // A count taken from a partial scan is not the match count, so only a scan
    // that reached the end of the match reports one.
    if (!search.scanTruncated) {
      ctx.enrich.total(search.matched);
    }

    /*
     * Every notice source lands in the single `notice` field (ctx.enrich.truncated
     * routes through it too, last-wins), so compose one string and emit it once.
     */
    const notices: string[] = [];
    const listTruncated = search.matched > input.limit;
    if (listTruncated) {
      notices.push(
        `Showing ${providers.length} of the ${search.matched} providers this search found — raise limit to see more.`,
      );
    }
    if (search.scanTruncated) {
      notices.push(
        `This list of providers is a sample, not the complete set: the search read the first ${search.scanRowCap.toLocaleString()} matching FCC deployment rows to see which holding companies matched, so companies whose rows fall outside that window are missing and the true match count is unknown. FCC deployment data is per census block, so a match of almost any size fills that window and no filter combination makes this result complete — a narrower name, state, or technology filter draws the window from a smaller pool and so surfaces a larger share of the matches, but only the local Form 477 mirror (FCC_MIRROR_ENABLED=true) searches every holding-company name and returns every match. What is missing is companies, not detail: each provider listed above carries its complete national states and technologies, looked up per company rather than read off that window.`,
      );
    }
    if (providers.length === 0) {
      const criteria = [
        input.name_search && `name="${input.name_search}"`,
        input.state && `state="${input.state}"`,
        input.tech_filter?.length && `tech codes=[${input.tech_filter.join(', ')}]`,
      ]
        .filter(Boolean)
        .join(', ');
      /*
       * A name paired with a state or technology filter is the combination that
       * comes back empty while each part matches on its own, because the filters
       * meet on a single deployment filing and a holding company number can file
       * under more than one name. Naming that beats a generic "remove filters".
       */
      const nameWithFiling =
        input.name_search !== undefined &&
        (input.state !== undefined || !!input.tech_filter?.length);
      notices.push(
        criteria
          ? `No providers matched ${criteria}. ${
              nameWithFiling
                ? `Every filter has to hold on one deployment filing together, and a holding company can file some technologies or states under an acquired brand name rather than the one searched — so search name="${input.name_search}" alone and read statesServed and techCodes off the result, which cover the whole company.`
                : 'Try a shorter name fragment or remove filters.'
            }`
          : 'No providers matched. FCC Open Data returned no deployment rows for an unfiltered search.',
      );
    }
    const notice = notices.join(' ');
    if (listTruncated) {
      ctx.enrich.truncated({ shown: providers.length, cap: input.limit, guidance: notice });
    } else if (notice) {
      ctx.enrich.notice(notice);
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
      `**Data Vintage:** ${result.dataVintage} | **Returned:** ${result.totalFound}`,
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
