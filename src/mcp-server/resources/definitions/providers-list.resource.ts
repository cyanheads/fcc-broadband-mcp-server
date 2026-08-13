/**
 * @fileoverview FCC broadband providers directory resource — one page of Form 477
 * holding companies, addressable by offset.
 * @module mcp-server/resources/definitions/providers-list.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';

/**
 * Holding companies one page returns. Also the number of single-hoconum name
 * lookups a page issues, which is what keeps it modest: the directory is ~2.2K
 * entries, and reading it whole was the 86 KB opaque payload this replaces.
 */
const PAGE_SIZE = 25;

export const providersListResource = resource('fcc-broadband://providers/list/{offset}', {
  name: 'fcc-broadband-providers-list',
  description:
    'One page of the Form 477 holding-company directory: up to 25 holding company numbers (hoconum) ordered by hoconum ascending, each resolved to its company name. ' +
    'Read fcc-broadband://providers/list/0 for the first page, then follow the nextOffset each response carries; every page also reports the directory total. ' +
    'Paging is for browsing the directory — to find one company by name, call fcc_search_providers instead. ' +
    'Feed a hoconum to fcc_get_provider for that company national coverage profile. ' +
    'Data is as of June 2021.',
  mimeType: 'application/json',
  params: z.object({
    offset: z
      .string()
      .regex(/^\d+$/)
      .describe(
        'Zero-based index of the first holding company on the page, digits only. Start at "0" and follow each response\'s nextOffset.',
      ),
  }),
  output: z.object({
    providers: z
      .array(
        z
          .object({
            hoconum: z
              .string()
              .describe('Holding company number — pass to fcc_get_provider for its profile.'),
            holdingCompanyName: z
              .string()
              .optional()
              .describe(
                'Holding company name from the FCC deployment table. Omitted when no deployment row carries this hoconum or the lookup failed.',
              ),
          })
          .describe('A holding company entry.'),
      )
      .describe('Holding companies on this page, ordered by hoconum ascending.'),
    offset: z.number().describe('Zero-based index of the first entry on this page.'),
    pageSize: z.number().describe('Maximum entries one page returns.'),
    count: z
      .number()
      .describe(
        'Entries actually returned on this page. Zero when the offset is past the end of the directory.',
      ),
    total: z.number().describe('Holding companies in the whole directory, across every page.'),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to read for the next page. Omitted on the last page and when the offset is past the end.',
      ),
    dataVintage: z.string().describe('Data vintage.'),
    notice: z
      .string()
      .describe(
        'Where this page sits in the directory, how to continue, and how to resolve a company name to a hoconum.',
      ),
  }),

  async handler(params, ctx) {
    const offset = parseInt(params.offset, 10);
    const service = getOpenDataService();
    const page = await service.listProviders({ limit: PAGE_SIZE, offset }, ctx);

    const names = await service.getProviderNames(
      page.providers.map((p) => p.hoconum),
      ctx,
    );
    const providers = page.providers.map((p) => {
      const holdingCompanyName = names.get(p.hoconum);
      return { hoconum: p.hoconum, ...(holdingCompanyName && { holdingCompanyName }) };
    });

    const nextOffset = offset + providers.length;
    const hasMore = providers.length > 0 && nextOffset < page.total;

    /*
     * An empty page is ambiguous on its own — an exhausted directory and an
     * empty one look identical — so the notice names which of the two it is.
     */
    const notices: string[] = [];
    if (page.total === 0) {
      notices.push('The holding-company directory is empty — FCC Open Data returned no entries.');
    } else if (providers.length === 0) {
      notices.push(
        `Offset ${offset} is past the end of the directory, which holds ${page.total} companies. Read fcc-broadband://providers/list/0 to start over.`,
      );
    } else {
      const range = `${offset + 1}–${offset + providers.length} of ${page.total}`;
      notices.push(
        hasMore
          ? `Showing holding companies ${range}. Read fcc-broadband://providers/list/${nextOffset} for the next page.`
          : `Showing holding companies ${range} — this is the last page.`,
      );
    }
    const unresolved = providers.filter((p) => p.holdingCompanyName === undefined).length;
    if (unresolved > 0) {
      notices.push(
        `${unresolved} of the ${providers.length} entries have no holdingCompanyName — the FCC deployment table returned no row for those holding company numbers.`,
      );
    }
    notices.push(
      'To go the other way and resolve a company name to its hoconum, call fcc_search_providers rather than paging this directory.',
    );

    ctx.log.info('fcc-broadband-providers-list', {
      offset,
      count: providers.length,
      total: page.total,
      unresolved,
    });

    return {
      providers,
      offset,
      pageSize: PAGE_SIZE,
      count: providers.length,
      total: page.total,
      ...(hasMore && { nextOffset }),
      dataVintage: 'June 2021 (last Form 477 filing period)',
      notice: notices.join(' '),
    };
  },

  list: () => ({
    resources: [
      {
        uri: 'fcc-broadband://providers/list/0',
        name: 'fcc-broadband-providers-list',
        mimeType: 'application/json',
      },
    ],
  }),
});
