/**
 * @fileoverview FCC census block geocoder — converts lat/lon to census block FIPS.
 * @module mcp-server/tools/definitions/geocode-block.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGeoApiService } from '@/services/geo-api/geo-api-service.js';

export const geocodeBlockTool = tool('fcc_geocode_block', {
  title: 'Geocode Census Block',
  description:
    'Converts a latitude/longitude coordinate to a 15-digit census block FIPS code, plus county FIPS, county name, state FIPS, state code, and state name. ' +
    'This is the required prerequisite for fcc_search_availability since the broadband dataset is indexed by census block, not address. ' +
    'Uses the FCC public Geo API — no authentication required.',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe(
        'Latitude of the location in decimal degrees (e.g., 47.6062 for Seattle, WA). Must be within the continental US, Alaska, Hawaii, or US territories.',
      ),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe(
        'Longitude of the location in decimal degrees (e.g., -122.3321 for Seattle, WA). Negative for western hemisphere.',
      ),
  }),

  output: z.object({
    blockFips: z
      .string()
      .describe(
        '15-digit census block FIPS code (e.g., "530330081021016"). Pass this to fcc_search_availability to look up broadband providers.',
      ),
    countyFips: z
      .string()
      .describe('5-digit county FIPS code (e.g., "53033" for King County, WA).'),
    countyName: z.string().describe('Human-readable county name (e.g., "King").'),
    stateFips: z.string().describe('2-digit state FIPS code (e.g., "53" for Washington).'),
    stateCode: z.string().describe('2-letter state abbreviation (e.g., "WA").'),
    stateName: z.string().describe('Full state name (e.g., "Washington").'),
  }),

  errors: [
    {
      reason: 'block_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No census block found at the given coordinates — may be over water or outside US coverage.',
      recovery:
        'Verify the coordinates are within US territory and not over a large body of water. Try nearby coordinates.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_geocode_block', { latitude: input.latitude, longitude: input.longitude });
    const service = getGeoApiService();
    const result = await service.findBlock(input.latitude, input.longitude, ctx);

    if (!result) {
      throw ctx.fail(
        'block_not_found',
        'No census block found at the given coordinates — may be over water or outside US coverage.',
        { ...ctx.recoveryFor('block_not_found') },
      );
    }

    ctx.log.info('fcc_geocode_block succeeded', { blockFips: result.blockFips });
    return result;
  },

  format: (result) => {
    const lines = [
      `## Census Block Location`,
      `**Block FIPS:** \`${result.blockFips}\``,
      `**County:** ${result.countyName} (FIPS: ${result.countyFips})`,
      `**State:** ${result.stateName} (${result.stateCode}, FIPS: ${result.stateFips})`,
      ``,
      `Use \`blockFips: "${result.blockFips}"\` with \`fcc_search_availability\` to look up broadband providers.`,
    ];
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
