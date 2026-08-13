/**
 * @fileoverview FCC provider national profile — coverage by speed tier and technology.
 * @module mcp-server/tools/definitions/get-provider.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';
import { SPEED_TIER_LABELS, TECH_CODE_LABELS } from '@/services/open-data/types.js';

export const getProviderTool = tool('fcc_get_provider', {
  title: 'Get Provider Profile',
  description:
    'Returns a national-level coverage profile for a specific holding company (by hoconum): ' +
    'technologies deployed and the population covered at each download speed tier. ' +
    'Population figures come from the FCC provider summary table and count each person once, ' +
    'regardless of how many technologies the provider uses to reach them. ' +
    'Use fcc_search_providers to find valid hoconum values. ' +
    'Data is from FCC Form 477 (as of June 2021).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    hoconum: z
      .string()
      .regex(/^\d+$/)
      .describe(
        'Holding company number from fcc_search_providers — digits only, e.g. "130317" for Comcast Corporation.',
      ),
  }),

  output: z.object({
    hoconum: z.string().describe('Holding company number.'),
    holdingCompanyName: z.string().describe('Holding company name.'),
    techCodes: z
      .array(z.string())
      .describe(
        'Technology codes this provider reports nationally. Empty when the provider reports no population coverage (e.g. business-only carriers).',
      ),
    techLabels: z.array(z.string()).describe('Human-readable technology descriptions.'),
    speedTierPopulation: z
      .array(
        z
          .object({
            tier: z.string().describe('Download speed threshold (e.g., "25 Mbps").'),
            population: z
              .number()
              .describe('People covered at or above this download speed, counted once each.'),
          })
          .describe('A speed tier with its covered population.'),
      )
      .describe(
        'National covered population by download speed tier, from the FCC all-technology rollup. Tiers with no coverage are omitted; empty when the provider reports no population coverage.',
      ),
    dataVintage: z.string().describe('Data vintage — Form 477 data as of June 2021.'),
  }),

  errors: [
    {
      reason: 'provider_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No provider found with the given hoconum.',
      recovery:
        'Use fcc_search_providers with a holding company name to find valid hoconum values.',
    },
    {
      reason: 'live_provider_timeout',
      code: JsonRpcErrorCode.Timeout,
      retryable: false,
      when: 'A live FCC Open Data lookup exceeded its 30-second budget; the queries are point lookups, so a retry reaches the same result.',
      recovery:
        'FCC Open Data is not serving this lookup right now; try again later. Operators can enable the local Form 477 mirror (FCC_MIRROR_ENABLED=true) to serve provider profiles locally.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_get_provider', { hoconum: input.hoconum });
    const service = getOpenDataService();
    const summary = await service.getProviderSummary(input.hoconum, ctx);

    if (!summary) {
      throw ctx.fail(
        'provider_not_found',
        `No provider found with hoconum "${input.hoconum}". Use fcc_search_providers to find valid hoconum values.`,
        { ...ctx.recoveryFor('provider_not_found') },
      );
    }

    const speedTierPopulation = Object.entries(summary.speedTierPopulation)
      .filter(([, population]) => population > 0)
      .map(([tier, population]) => ({
        tier: SPEED_TIER_LABELS[tier] ?? tier,
        population,
      }));

    const techLabels = summary.techCodes.map(
      (code) => TECH_CODE_LABELS[code] ?? `Technology ${code}`,
    );

    ctx.log.info('fcc_get_provider succeeded', {
      hoconum: summary.hoconum,
      techCount: summary.techCodes.length,
    });

    return {
      hoconum: summary.hoconum,
      holdingCompanyName: summary.holdingCompanyName,
      techCodes: summary.techCodes,
      techLabels,
      speedTierPopulation,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const lines = [
      `## Provider Profile — ${result.holdingCompanyName}`,
      `**Hoconum:** ${result.hoconum} | **Data Vintage:** ${result.dataVintage}`,
    ];

    if (result.techCodes.length > 0) {
      lines.push('', `### Technologies Deployed`);
      for (let i = 0; i < result.techCodes.length; i++) {
        lines.push(`- **${result.techLabels[i]}** (code: ${result.techCodes[i]})`);
      }
    }

    if (result.speedTierPopulation.length > 0) {
      lines.push('', '### Speed Tier Coverage (National Population)');
      lines.push('| Speed Tier | Population |');
      lines.push('|:-----------|:-----------|');
      for (const tier of result.speedTierPopulation) {
        lines.push(`| ${tier.tier} | ${tier.population.toLocaleString()} |`);
      }
    } else {
      lines.push(
        '',
        'No national population coverage is reported for this holding company in the FCC provider summary. Business-only carriers appear this way; use fcc_search_availability for their block-level deployments.',
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
