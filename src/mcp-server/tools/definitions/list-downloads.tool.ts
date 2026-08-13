/**
 * @fileoverview FCC BDC bulk download file lister — manifests for post-2022 data.
 * @module mcp-server/tools/definitions/list-downloads.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getBdcApiService } from '@/services/bdc-api/bdc-api-service.js';

export const listDownloadsTool = tool('fcc_list_downloads', {
  title: 'List BDC Downloads',
  description:
    'Lists downloadable BDC data files for a specific as-of date — fixed availability by state and provider, mobile coverage, and challenge data — with file metadata (provider, state, technology, record count). ' +
    'Download URLs are included for each file. ' +
    'Requires FCC BDC API credentials (FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE). ' +
    'Use fcc_list_filing_periods first to determine valid as_of_date values (BDC dates start June 2022); a date that is not on the calendar, or that falls before the first BDC period, is rejected without credentials, while a well-formed date the BDC API does not publish is rejected once credentials let the published set be read. ' +
    'One as-of date can carry thousands of per-provider files, so results come back a page at a time: totalFiles counts every file matching the filters, the response reports the offset and the count on this page, and it carries a nextOffset to pass back for the following page until the last one, which omits it.',
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },

  input: z.object({
    as_of_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe(
        'BDC as-of date in YYYY-MM-DD format (e.g., "2024-06-30"). Get valid dates from fcc_list_filing_periods with include_bdc=true.',
      ),
    data_type: z
      .enum(['availability', 'challenge'])
      .default('availability')
      .describe(
        '"availability" = ISP-reported coverage files (by state and provider). "challenge" = consumer and government dispute records.',
      ),
    category: z
      .enum(['Summary', 'State', 'Provider'])
      .optional()
      .describe(
        'File category. "State" = per-state coverage files. "Provider" = per-provider files. "Summary" = aggregate coverage tables.',
      ),
    technology_type: z
      .enum(['Fixed Broadband', 'Mobile Broadband', 'Mobile Voice'])
      .optional()
      .describe('Filter to a specific technology type of coverage data.'),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe('Filter to one state\'s files (2-letter abbreviation, e.g., "WA").'),
    provider_name: z
      .string()
      .optional()
      .describe('Partial provider holding company name to filter results (case-insensitive).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('Maximum number of files to return on one page.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based index of the first file to return, within the files matching the filters. Start at 0 and follow the nextOffset each response carries.',
      ),
  }),

  output: z.object({
    files: z
      .array(
        z
          .object({
            fileId: z.string().describe('Unique file identifier.'),
            fileName: z.string().describe('File name.'),
            category: z.string().describe('File category (e.g., "State", "Provider", "Summary").'),
            subcategory: z.string().optional().describe('File subcategory when available.'),
            technologyType: z
              .string()
              .optional()
              .describe('Technology type covered (e.g., "Fixed Broadband", "Mobile Broadband").'),
            stateName: z.string().optional().describe('State name for state-level files.'),
            stateAbbr: z.string().optional().describe('State abbreviation for state-level files.'),
            providerName: z.string().optional().describe('Provider name for provider-level files.'),
            fileSizeBytes: z.number().optional().describe('File size in bytes when available.'),
            recordCount: z
              .number()
              .optional()
              .describe('Number of records in the file when available.'),
            downloadUrl: z.string().describe('Direct download URL for the file.'),
            asOfDate: z.string().describe('As-of date for this file.'),
          })
          .describe('A downloadable BDC file entry.'),
      )
      .describe('Downloadable BDC files on this page, in the order the BDC API lists them.'),
    totalFiles: z
      .number()
      .describe(
        'Files matching the filters across every page, not just this one. Compare against the count enrichment field to see how much of the set this page holds.',
      ),
    asOfDate: z.string().describe('The queried as-of date.'),
    dataType: z.string().describe('Data type queried (availability or challenge).'),
  }),

  // Agent-facing success-path context: page window, applied filter echo, and
  // where this page sits in the matching set.
  enrichment: {
    offset: z.number().describe('Zero-based index of the first file on this page.'),
    pageSize: z.number().describe('Maximum files one page returns — the limit that was applied.'),
    count: z
      .number()
      .describe(
        'Files actually returned on this page. Zero both when nothing matched and when the offset is past the end; the notice says which.',
      ),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to pass back for the next page. Omitted on the last page and when the offset is past the end.',
      ),
    truncated: z
      .boolean()
      .describe('True when this page holds fewer files than totalFiles, so more pages exist.'),
    appliedFilters: z
      .object({
        asOfDate: z.string().describe('As-of date queried.'),
        dataType: z.string().describe('Data type queried.'),
        category: z
          .string()
          .optional()
          .describe('Category filter applied. Absent when not filtered.'),
        technologyType: z
          .string()
          .optional()
          .describe('Technology type filter applied. Absent when not filtered.'),
        state: z
          .string()
          .optional()
          .describe('State filter applied. Absent for all-state results.'),
        providerName: z
          .string()
          .optional()
          .describe('Provider name filter applied. Absent when not filtered.'),
      })
      .describe('Filters applied to this query.'),
    notice: z
      .string()
      .describe(
        'Where this page sits in the matching set and how to continue — or, when the page is empty, whether nothing matched the filters or the offset ran past the end.',
      ),
  },

  enrichmentTrailer: {
    offset: { label: 'Offset' },
    pageSize: { label: 'Page size' },
    count: { label: 'Files on this page' },
    nextOffset: { label: 'Next offset' },
    truncated: { label: 'More pages' },
    appliedFilters: {
      render: (filters) => {
        const lines = [
          `- **As-of date:** ${filters.asOfDate}`,
          `- **Data type:** ${filters.dataType}`,
        ];
        if (filters.category) lines.push(`- **Category:** ${filters.category}`);
        if (filters.technologyType) lines.push(`- **Technology:** ${filters.technologyType}`);
        if (filters.state) lines.push(`- **State:** ${filters.state}`);
        if (filters.providerName) lines.push(`- **Provider:** "${filters.providerName}"`);
        return `**Applied Filters:**\n${lines.join('\n')}`;
      },
    },
  },

  errors: [
    {
      reason: 'credentials_required',
      code: JsonRpcErrorCode.Unauthorized,
      when: 'FCC_BDC_USERNAME or FCC_BDC_HASH_VALUE environment variables are not set.',
      recovery:
        'Set FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE from the broadbandmap.fcc.gov "Manage API Access" page.',
    },
    {
      reason: 'invalid_as_of_date',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The as_of_date is not a date on the calendar, falls before the first BDC filing period, or is not among the as-of dates the BDC API publishes. The first two are caught without credentials; the third needs them, since only the credentialed endpoint knows the published set.',
      recovery:
        'Read the thrown recovery hint — it says which of the three the date was — then call fcc_list_filing_periods with include_bdc=true for the published BDC as-of dates.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('fcc_list_downloads', {
      asOfDate: input.as_of_date,
      dataType: input.data_type,
      limit: input.limit,
      offset: input.offset,
    });

    const service = getBdcApiService();
    const { files, total } = await service.listDownloads(
      {
        asOfDate: input.as_of_date,
        dataType: input.data_type,
        ...(input.category !== undefined && { category: input.category }),
        ...(input.technology_type !== undefined && { technologyType: input.technology_type }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.provider_name !== undefined && { providerName: input.provider_name }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    ctx.log.info('fcc_list_downloads succeeded', {
      fileCount: files.length,
      totalFiles: total,
      asOfDate: input.as_of_date,
    });

    const nextOffset = input.offset + files.length;
    const hasMore = files.length > 0 && nextOffset < total;

    /*
     * An empty page is ambiguous on its own — nothing matched the filters and an
     * offset past the end look identical — so the notice names which of the two
     * it is, and otherwise says where the page sits and how to continue.
     */
    let notice: string;
    if (total === 0) {
      notice = `No files found for ${input.as_of_date} with the applied filters. Try removing category, technology, state, or provider filters, or verify the as_of_date with fcc_list_filing_periods.`;
    } else if (files.length === 0) {
      notice = `Offset ${input.offset} is past the end of the ${total} files matching the filters. Call again with offset=0 to start over.`;
    } else {
      const range = `${input.offset + 1}–${input.offset + files.length} of ${total}`;
      notice = hasMore
        ? `Showing files ${range}. Call again with offset=${nextOffset} for the next page.`
        : `Showing files ${range} — this is the last page.`;
    }

    const appliedFilters = {
      asOfDate: input.as_of_date,
      dataType: input.data_type,
      ...(input.category !== undefined && { category: input.category }),
      ...(input.technology_type !== undefined && { technologyType: input.technology_type }),
      ...(input.state !== undefined && { state: input.state }),
      ...(input.provider_name !== undefined && { providerName: input.provider_name }),
    };
    ctx.enrich({
      appliedFilters,
      offset: input.offset,
      pageSize: input.limit,
      count: files.length,
      ...(hasMore && { nextOffset }),
      truncated: files.length < total,
    });
    ctx.enrich.notice(notice);

    return {
      files,
      totalFiles: total,
      asOfDate: input.as_of_date,
      dataType: input.data_type,
    };
  },

  format: (result) => {
    const lines = [
      `## BDC Download Files — ${result.asOfDate}`,
      `**Data Type:** ${result.dataType} | **Showing:** ${result.files.length} of ${result.totalFiles} matching files`,
      '',
    ];

    if (result.files.length === 0) {
      // Same split the notice makes, so the two surfaces never disagree about
      // why a page came back empty.
      lines.push(
        result.totalFiles > 0
          ? `No files on this page — the offset is past the end of the ${result.totalFiles} matching files.`
          : 'No files found matching the filters.',
      );
    } else {
      for (const f of result.files) {
        lines.push(`### ${f.fileName}`);
        lines.push(
          `**File ID:** ${f.fileId} | **Category:** ${f.category}${f.subcategory ? ` / ${f.subcategory}` : ''} | **As-Of Date:** ${f.asOfDate}`,
        );
        if (f.technologyType) lines.push(`**Technology:** ${f.technologyType}`);
        if (f.stateName) lines.push(`**State:** ${f.stateName} (${f.stateAbbr})`);
        if (f.providerName) lines.push(`**Provider:** ${f.providerName}`);
        if (f.recordCount !== undefined)
          lines.push(`**Records:** ${f.recordCount.toLocaleString()}`);
        lines.push(
          `**File Size:** ${f.fileSizeBytes !== undefined ? `${f.fileSizeBytes} bytes (${(f.fileSizeBytes / 1024 / 1024).toFixed(1)} MB)` : 'Not available'}`,
        );
        lines.push(`**Download URL:** ${f.downloadUrl}`);
        lines.push('');
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
