/**
 * @fileoverview FCC broadband availability search by census block — queries ISPs and speeds.
 * @module mcp-server/tools/definitions/search-availability.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';
import { TECH_CODE_LABELS, TECH_CODES } from '@/services/open-data/types.js';

export const searchAvailabilityTool = tool('fcc_search_availability', {
  title: 'Search Broadband Availability',
  description:
    'Queries broadband providers and advertised speeds at a census block from FCC Form 477 data (as of June 2021). ' +
    'Answers "which ISPs serve this location and what speeds do they offer?" — the core tool for address-level broadband lookup. ' +
    'Requires a 15-digit census block FIPS code; use fcc_geocode_block to convert coordinates first. ' +
    'Data reflects ISP-reported availability at the block level, which may overstate actual coverage for some addresses.',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    block_fips: z
      .string()
      .regex(/^\d{15}$/)
      .describe(
        '15-digit census block FIPS code on 2010 census boundaries, the vintage this Form 477 dataset is keyed by (e.g., "530330081002024"). Obtain from fcc_geocode_block using address coordinates — a 2020-vintage block ID matches no deployment row.',
      ),
    tech_filter: z
      .array(z.enum(TECH_CODES))
      .optional()
      .describe(
        'Technology codes to filter, from the complete Form 477 taxonomy: 0=All other, 10=Asymmetric xDSL, 11=ADSL2, 12=VDSL, 20=Symmetric xDSL, 30=Other copper wireline, 40=Cable modem, 41=Cable modem DOCSIS 1/1.1/2.0, 42=Cable modem DOCSIS 3.0, 43=Cable modem DOCSIS 3.1, 50=Fiber to the end user, 60=Satellite, 70=Terrestrial fixed wireless, 90=Electric power line. Omit to return all technologies.',
      ),
    min_speed_down: z
      .number()
      .min(0)
      .optional()
      .describe(
        'Minimum advertised download speed in Mbps to include in results. Omit to return all providers regardless of speed.',
      ),
    consumer: z
      .boolean()
      .optional()
      .describe(
        'Filter to consumer service (true) or business service (false). Omit to return both consumer and business offerings.',
      ),
  }),

  output: z.object({
    blockFips: z.string().describe('The queried census block FIPS code.'),
    providers: z
      .array(
        z
          .object({
            providerId: z.string().describe('FCC provider registration number (FRN).'),
            providerName: z.string().describe('Registered provider name.'),
            holdingCompanyName: z
              .string()
              .describe('Parent holding company name (e.g., "Comcast").'),
            hoconum: z
              .string()
              .describe(
                'Holding company number — use with fcc_get_provider for a national profile.',
              ),
            stateAbbr: z.string().describe('State where coverage is reported.'),
            techCode: z
              .string()
              .describe(
                'FCC Form 477 technology code (e.g., "50" = fiber, "43" = cable DOCSIS 3.1, "60" = satellite).',
              ),
            techLabel: z.string().describe('Human-readable technology description.'),
            maxDownloadMbps: z.number().describe('Maximum advertised download speed in Mbps.'),
            maxUploadMbps: z.number().describe('Maximum advertised upload speed in Mbps.'),
            consumer: z.boolean().describe('Whether this offering serves consumers.'),
            business: z.boolean().describe('Whether this offering serves businesses.'),
          })
          .describe('One ISP offering at this census block.'),
      )
      .describe('ISP offerings reported for this census block.'),
    totalProviders: z
      .number()
      .describe('Total number of distinct holding companies offering service at this block.'),
    dataVintage: z
      .string()
      .describe(
        'Data vintage — all Form 477 data on FCC Open Data is as of June 2021. For newer BDC data, use fcc_list_downloads.',
      ),
  }),

  // Agent-facing success-path context: applied filter echo and empty-result notice.
  // Reaches both structuredContent and content[] trailer without a format() entry.
  enrichment: {
    appliedFilters: z
      .object({
        techFilter: z
          .array(z.string())
          .optional()
          .describe('Technology codes applied as a filter. Absent when no tech filter was used.'),
        minSpeedDown: z
          .number()
          .optional()
          .describe(
            'Minimum advertised download speed filter in Mbps. Absent when no speed filter was used.',
          ),
        consumerFilter: z
          .boolean()
          .optional()
          .describe(
            'Consumer/business filter applied. true = consumer only, false = business only. Absent when both were returned.',
          ),
      })
      .describe('Filters applied to this query.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when no providers are found — suggests how to broaden the query. Absent on successful results.',
      ),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const lines: string[] = [];
        if (filters.techFilter?.length)
          lines.push(`- **Tech filter:** ${filters.techFilter.join(', ')}`);
        if (filters.minSpeedDown !== undefined)
          lines.push(`- **Min speed:** ${filters.minSpeedDown} Mbps down`);
        if (filters.consumerFilter !== undefined)
          lines.push(
            `- **Service type:** ${filters.consumerFilter ? 'Consumer only' : 'Business only'}`,
          );
        return lines.length > 0
          ? `**Applied Filters:**\n${lines.join('\n')}`
          : '**Applied Filters:** none';
      },
    },
  },

  errors: [
    {
      reason: 'block_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No providers in the FCC dataset for this census block.',
      recovery:
        'Block may be non-residential or have no reported coverage. Try fcc_geocode_block to verify the FIPS code or check a nearby block.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_search_availability', { blockFips: input.block_fips });
    const service = getOpenDataService();

    const records = await service.getDeploymentByBlock(
      input.block_fips,
      {
        ...(input.tech_filter?.length && { techCodes: input.tech_filter }),
        ...(input.min_speed_down !== undefined && { minSpeedDown: input.min_speed_down }),
        ...(input.consumer !== undefined && { consumer: input.consumer }),
      },
      ctx,
    );

    if (
      records.length === 0 &&
      !input.tech_filter?.length &&
      input.min_speed_down === undefined &&
      input.consumer === undefined
    ) {
      throw ctx.fail(
        'block_not_found',
        `No broadband providers found for census block ${input.block_fips}. The block may be non-residential or have no reported coverage.`,
        { ...ctx.recoveryFor('block_not_found') },
      );
    }

    const holdingCompanyNames = new Set(records.map((r) => r.holdingCompanyName));

    const providers = records.map((r) => ({
      providerId: r.providerId,
      providerName: r.providerName,
      holdingCompanyName: r.holdingCompanyName,
      hoconum: r.hoconum,
      stateAbbr: r.stateAbbr,
      techCode: r.techCode,
      techLabel: TECH_CODE_LABELS[r.techCode] ?? `Technology ${r.techCode}`,
      maxDownloadMbps: r.maxDownloadMbps,
      maxUploadMbps: r.maxUploadMbps,
      consumer: r.consumer,
      business: r.business,
    }));

    ctx.log.info('fcc_search_availability succeeded', {
      blockFips: input.block_fips,
      recordCount: records.length,
      distinctHolcos: holdingCompanyNames.size,
    });

    const appliedFilters = {
      ...(input.tech_filter?.length && { techFilter: input.tech_filter }),
      ...(input.min_speed_down !== undefined && { minSpeedDown: input.min_speed_down }),
      ...(input.consumer !== undefined && { consumerFilter: input.consumer }),
    };
    ctx.enrich({ appliedFilters });
    if (providers.length === 0) {
      ctx.enrich.notice(
        `No providers found for block ${input.block_fips} with the current filters. Try removing tech or speed filters, or verify the FIPS code with fcc_geocode_block.`,
      );
    }

    return {
      blockFips: input.block_fips,
      providers,
      totalProviders: holdingCompanyNames.size,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const lines = [
      `## Broadband Availability — Block ${result.blockFips}`,
      `**Data Vintage:** ${result.dataVintage}`,
      `**Distinct Providers:** ${result.totalProviders}`,
      '',
    ];

    if (result.providers.length === 0) {
      lines.push('No providers found for this census block.');
    } else {
      for (const p of result.providers) {
        lines.push(`### ${p.holdingCompanyName} (${p.providerName})`);
        lines.push(`**Hoconum:** ${p.hoconum} | **Provider ID:** ${p.providerId}`);
        lines.push(`**Technology:** ${p.techLabel} (code: ${p.techCode})`);
        lines.push(`**Speed:** ${p.maxDownloadMbps} Mbps down / ${p.maxUploadMbps} Mbps up`);
        const serviceTypes = [p.consumer && 'Consumer', p.business && 'Business']
          .filter(Boolean)
          .join(', ');
        lines.push(`**Service Type:** ${serviceTypes || 'Unknown'} | **State:** ${p.stateAbbr}`);
        lines.push('');
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
