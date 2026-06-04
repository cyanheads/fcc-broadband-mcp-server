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
    'states served, technologies deployed, and the number of locations covered at each download speed tier. ' +
    'Use fcc_search_providers to find valid hoconum values. ' +
    'Data is from FCC Form 477 (as of June 2021).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    hoconum: z
      .string()
      .describe(
        'Holding company number from fcc_search_providers (e.g., "130152" for Comcast). Required identifier for the provider.',
      ),
  }),

  output: z.object({
    hoconum: z.string().describe('Holding company number.'),
    holdingCompanyName: z.string().describe('Holding company name.'),
    techCodes: z.array(z.string()).describe('Technology codes this provider deploys nationally.'),
    techLabels: z.array(z.string()).describe('Human-readable technology descriptions.'),
    speedTierLocations: z
      .array(
        z
          .object({
            tier: z.string().describe('Speed tier label (e.g., "25 Mbps").'),
            locationCount: z.number().describe('Number of locations with service at this tier.'),
          })
          .describe('A speed tier with location count.'),
      )
      .describe('Download speed tier location counts (national totals).'),
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

    const speedTierLocations = Object.entries(summary.speedTierLocations)
      .filter(([, count]) => count > 0)
      .map(([tier, count]) => ({
        tier: SPEED_TIER_LABELS[tier] ?? tier,
        locationCount: count,
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
      speedTierLocations,
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },

  format: (result) => {
    const lines = [
      `## Provider Profile — ${result.holdingCompanyName}`,
      `**Hoconum:** ${result.hoconum} | **Data Vintage:** ${result.dataVintage}`,
      '',
      `### Technologies Deployed`,
    ];

    for (let i = 0; i < result.techCodes.length; i++) {
      lines.push(`- **${result.techLabels[i]}** (code: ${result.techCodes[i]})`);
    }

    if (result.speedTierLocations.length > 0) {
      lines.push('', '### Speed Tier Coverage (National Locations)');
      lines.push('| Speed Tier | Locations |');
      lines.push('|:-----------|:----------|');
      for (const tier of result.speedTierLocations) {
        lines.push(`| ${tier.tier} | ${tier.locationCount.toLocaleString()} |`);
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
