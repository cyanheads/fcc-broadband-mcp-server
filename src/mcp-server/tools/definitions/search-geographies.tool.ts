/**
 * @fileoverview Discover 2021 place and CBSA GEOIDs by literal name fragment.
 * @module mcp-server/tools/definitions/search-geographies.tool
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

export const searchGeographiesTool = tool('fcc_search_geographies', {
  title: 'Search Geographies',
  description:
    'Find census places and CBSAs (metro areas) by case-insensitive literal name substring in the 2021 FCC geography lookup. Keep ambiguous matches distinct and choose the geography_type and geography_id to pass to fcc_get_coverage_summary. Include a location qualifier in name to narrow results; CBSA codes do not encode state membership. Always queries live FCC Open Data, even with the Form 477 mirror enabled, and needs no BDC credentials. Follow nextOffset until absent; no total match count is computed.',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  input: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Nonblank literal name fragment, such as "Casper, WY". Apostrophes, percent signs and underscores are literal characters.',
      ),
    geography_type: z
      .union([z.literal(''), z.enum(['place', 'cbsa']).describe('Place or CBSA.')])
      .optional()
      .describe('Limit to place or cbsa; omit or leave blank to search both.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum matches per page (1–100), default 20.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Zero-based match offset; start at 0, then use nextOffset.'),
  }),
  output: z.object({
    geographies: z
      .array(
        z
          .object({
            geography_type: z
              .enum(['place', 'cbsa'])
              .describe('Type to pass to fcc_get_coverage_summary.'),
            geography_id: z.string().describe('GEOID to pass to fcc_get_coverage_summary.'),
            name: z.string().describe('Name as recorded in the FCC lookup.'),
          })
          .describe('One distinct named geography.'),
      )
      .describe('Distinct named matches ordered by name, type, and GEOID.'),
    count: z.number().describe('Number of matches on this page, not a total.'),
    offset: z.number().describe('Zero-based match offset applied.'),
    nextOffset: z
      .number()
      .optional()
      .describe('Offset for the next page; absent on a final or empty page.'),
    dataVintage: z.string().describe('Geography lookup year.'),
  }),
  enrichment: {
    truncated: z.boolean().optional().describe('More matches remain after this page.'),
    shown: z.number().optional().describe('Matches shown on this page.'),
    cap: z.number().optional().describe('Page limit applied.'),
    notice: z
      .string()
      .optional()
      .describe('Empty-page guidance or notice that more matches remain.'),
  },
  async handler(input, ctx) {
    const result = await getOpenDataService().searchGeographies(
      {
        name: input.name,
        ...(input.geography_type && { geographyType: input.geography_type }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );
    if (result.geographies.length === 0) {
      ctx.enrich.notice(
        input.offset > 0
          ? 'No matches on this page. The offset may be past the end; restart at offset 0 or shorten the name fragment.'
          : 'No geographies matched. Try a shorter name fragment or remove geography_type.',
      );
    } else if (result.nextOffset !== undefined) {
      ctx.enrich.truncated({
        shown: result.geographies.length,
        cap: input.limit,
        guidance: `This page reached limit ${input.limit}; more matches remain. Repeat with offset=${result.nextOffset}.`,
      });
    }
    return {
      ...result,
      count: result.geographies.length,
      offset: input.offset,
      dataVintage: '2021',
    };
  },
  format: (result) => [
    {
      type: 'text',
      text: [
        '## Geography Matches',
        `**Data Vintage:** ${result.dataVintage} | **Count:** ${result.count} | **Offset:** ${result.offset}`,
        ...result.geographies.map(
          (geo) =>
            `- ${geo.name} — geography_type=${geo.geography_type}, geography_id=${geo.geography_id}`,
        ),
        ...(result.nextOffset !== undefined ? [`**Next Offset:** ${result.nextOffset}`] : []),
      ].join('\n'),
    },
  ],
});
