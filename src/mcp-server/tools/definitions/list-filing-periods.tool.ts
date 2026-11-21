/**
 * @fileoverview FCC broadband filing periods lister — Form 477 and BDC as-of dates.
 * @module mcp-server/tools/definitions/list-filing-periods.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from '@/config/server-config.js';
import { getBdcApiService } from '@/services/bdc-api/bdc-api-service.js';
import { AREA_TABLE_BY_DATE } from '@/services/open-data/area-filing-periods.js';

export const listFilingPeriodsTool = tool('fcc_list_filing_periods', {
  title: 'List Filing Periods',
  description:
    'Lists Form 477 filing periods (June 2015 to June 2021) with Area Table availability and BDC as-of dates from the authenticated API (June 2022 onward, requires credentials). ' +
    'When hasBdcCredentials is true, call this before fcc_list_downloads to determine valid as_of_date values. ' +
    'Note: there is a data gap between June 2021 (last Form 477) and June 2022 (first BDC filing period).',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    include_bdc: z
      .boolean()
      .default(false)
      .describe(
        'When true, also fetches BDC as-of dates from the authenticated API (requires FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE). When false (default), returns only hardcoded Form 477 periods.',
      ),
  }),

  output: z.object({
    periods: z
      .array(
        z
          .object({
            asOfDate: z
              .string()
              .describe('Filing period as-of date in YYYY-MM-DD format (e.g., "2021-06-30").'),
            source: z
              .enum(['form477', 'bdc'])
              .describe(
                '"form477" = legacy ISP-reported data (2015–2021). "bdc" = Broadband Data Collection (2022+).',
              ),
            publicationDate: z
              .string()
              .optional()
              .describe('Date the dataset was published, if available.'),
            areaCoverageAvailable: z
              .boolean()
              .optional()
              .describe(
                'Whether the Form 477 filing date is accepted by the three Area Table tools. Omitted for BDC dates.',
              ),
          })
          .describe('A filing period entry.'),
      )
      .describe('Available filing periods sorted newest first.'),
    form477Count: z.number().describe('Number of Form 477 periods returned (always available).'),
    bdcCount: z
      .number()
      .describe(
        'Number of BDC periods returned (0 when credentials not configured or include_bdc=false).',
      ),
    hasBdcCredentials: z
      .boolean()
      .describe('Whether BDC API credentials are configured in this deployment.'),
    dataNote: z.string().describe('Note on data availability and the Form 477 vs. BDC gap.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('fcc_list_filing_periods', { includeBdc: input.include_bdc });
    const service = getBdcApiService();
    const config = getServerConfig();
    const hasBdcCredentials = !!(config.bdcUsername && config.bdcHashValue);

    const periods = await service.listFilingPeriods({ includeBdc: input.include_bdc }, ctx);

    const form477Periods = periods.filter((p) => p.source === 'form477');
    const bdcPeriods = periods.filter((p) => p.source === 'bdc');

    // Sort newest first
    const sorted = periods
      .map((period) =>
        period.source === 'form477'
          ? { ...period, areaCoverageAvailable: Object.hasOwn(AREA_TABLE_BY_DATE, period.asOfDate) }
          : period,
      )
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));

    ctx.log.info('fcc_list_filing_periods succeeded', {
      form477Count: form477Periods.length,
      bdcCount: bdcPeriods.length,
    });

    return {
      periods: sorted,
      form477Count: form477Periods.length,
      bdcCount: bdcPeriods.length,
      hasBdcCredentials,
      dataNote:
        'Form 477 periods with areaCoverageAvailable set to true (Yes in the Area Coverage column) can be queried without credentials. ' +
        (hasBdcCredentials
          ? 'BDC data (2022+) is available as bulk CSV downloads only — use fcc_list_downloads to get file manifests. '
          : 'BDC bulk downloads are unavailable in this deployment. ') +
        'There is a data gap between June 2021 (last Form 477) and June 2022 (first BDC period).',
    };
  },

  format: (result) => {
    const lines = [
      `## FCC Broadband Filing Periods`,
      `**Form 477 Periods:** ${result.form477Count} | **BDC Periods:** ${result.bdcCount} | **BDC Credentials:** ${result.hasBdcCredentials ? 'Configured' : 'Not configured'}`,
      ``,
      `> ${result.dataNote}`,
      '',
      `| As-Of Date | Source | Publication Date | Area Coverage |`,
      `|:-----------|:-------|:-----------------|:--------------|`,
    ];

    for (const p of result.periods) {
      const sourceLabel = p.source === 'form477' ? 'Form 477' : 'BDC';
      const areaCoverage =
        p.areaCoverageAvailable === undefined ? '—' : p.areaCoverageAvailable ? 'Yes' : 'No';
      lines.push(
        `| ${p.asOfDate} | ${sourceLabel} | ${p.publicationDate ?? '—'} | ${areaCoverage} |`,
      );
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
