/**
 * @fileoverview FCC broadband coverage summary resource — addressable by geography type and GEOID.
 * @module mcp-server/resources/definitions/geography-summary.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getOpenDataService } from '@/services/open-data/open-data-service.js';
import { geoidShapeError } from '@/services/open-data/types.js';

export const geographySummaryResource = resource('fcc-broadband://geography/{type}/{id}/summary', {
  name: 'fcc-broadband-geography-summary',
  description:
    'Broadband coverage summary for a specific geography: provider counts by speed tier, urban/rural split, tribal breakdown. ' +
    'Addressable by type and GEOID. Uses 25 Mbps speed threshold and acfosw technology filter.',
  mimeType: 'application/json',
  params: z.object({
    type: z
      .string()
      .describe(
        'Geography type: nation, state, county, cd (congressional district), place, cbsa, or tribal.',
      ),
    id: z
      .string()
      .describe(
        'FIPS GEOID, validated against the digit count its type expects. State: 2-digit (e.g., "06"). County: 5-digit (e.g., "06037"). Congressional district: 4-digit (e.g., "0601"). CBSA: 5-digit (e.g., "31080"). Place: 7-digit (e.g., "0644000"). Nation: "0". Tribal: BIA area ID.',
      ),
  }),
  output: z.object({
    geography: z
      .object({
        type: z.string().describe('Geography type.'),
        id: z.string().describe('FIPS GEOID.'),
        name: z.string().optional().describe('Human-readable name.'),
      })
      .describe('The queried geography.'),
    population: z
      .object({
        noCoverage: z.number().describe('Population with no coverage.'),
        oneProvider: z.number().describe('Population with one provider.'),
        twoProviders: z.number().describe('Population with two providers.'),
        threeOrMore: z.number().describe('Population with three or more providers.'),
        total: z.number().describe('Total population.'),
      })
      .describe('Population counts by provider tier.'),
    coveragePct: z.number().describe('Percentage with at least one provider.'),
    unservedPct: z.number().describe('Percentage with no providers.'),
    competitivePct: z.number().describe('Percentage with two or more providers.'),
    segments: z
      .array(
        z
          .object({
            urbanRural: z.enum(['R', 'U']).describe('Rural or urban.'),
            tribal: z.enum(['T', 'N']).describe('Tribal or non-tribal.'),
            total: z.number().describe('Total population in segment.'),
            noCoverage: z.number().describe('Unserved population in segment.'),
            unservedPct: z.number().describe('Unserved percentage in segment.'),
          })
          .describe('One urban/rural × tribal/non-tribal population segment.'),
      )
      .describe('Segment breakdown.'),
    dataVintage: z.string().describe('Data vintage.'),
  }),

  async handler(params, ctx) {
    const validTypes = ['nation', 'state', 'county', 'cd', 'place', 'cbsa', 'tribal'];
    if (!validTypes.includes(params.type)) {
      throw validationError(
        `Invalid geography type "${params.type}". Valid types: ${validTypes.join(', ')}.`,
      );
    }

    if (params.type !== 'nation') {
      const shapeError = geoidShapeError(params.type, params.id);
      if (shapeError) {
        throw validationError(shapeError, {
          recovery: {
            hint: 'Use the digit count the geography type expects: state=2, county=5, cd=4, cbsa=5, place=7.',
          },
        });
      }
    }

    const service = getOpenDataService();
    const [segments, geoName] = await Promise.all([
      service.getAreaSegments(
        {
          geographyType: params.type,
          ...(params.type !== 'nation' && { geographyId: params.id }),
          techFilter: 'acfosw',
          speedDown: '25',
        },
        ctx,
      ),
      service.getGeographyName(params.type, params.id, ctx).catch(() => undefined),
    ]);

    /*
     * No Area Table rows at all means the GEOID identifies no geography — a
     * distinct answer from a geography whose rows report zero population, which
     * still comes back as segments and reads as genuine zero coverage below.
     */
    if (segments.length === 0) {
      throw notFound(
        `No area data found for geography type="${params.type}", id="${params.type === 'nation' ? '0' : params.id}". The GEOID matches no geography in the FCC Area Table.`,
        {
          recovery: {
            hint: 'Verify the GEOID identifies a real geography of this type, or query a broader type such as county or state.',
          },
        },
      );
    }

    let totalNoCoverage = 0;
    let totalOne = 0;
    let totalTwo = 0;
    let totalThreePlus = 0;
    let totalPop = 0;

    for (const seg of segments) {
      totalNoCoverage += seg.population.noCoverage;
      totalOne += seg.population.oneProvider;
      totalTwo += seg.population.twoProviders;
      totalThreePlus += seg.population.threeOrMore;
      totalPop += seg.population.total;
    }

    const coveragePct = totalPop > 0 ? ((totalPop - totalNoCoverage) / totalPop) * 100 : 0;
    const unservedPct = totalPop > 0 ? (totalNoCoverage / totalPop) * 100 : 0;
    const competitivePct = totalPop > 0 ? ((totalTwo + totalThreePlus) / totalPop) * 100 : 0;

    return {
      geography: {
        type: params.type,
        id: params.type === 'nation' ? '0' : params.id,
        ...(geoName && { name: geoName }),
      },
      population: {
        noCoverage: totalNoCoverage,
        oneProvider: totalOne,
        twoProviders: totalTwo,
        threeOrMore: totalThreePlus,
        total: totalPop,
      },
      coveragePct: Math.round(coveragePct * 10) / 10,
      unservedPct: Math.round(unservedPct * 10) / 10,
      competitivePct: Math.round(competitivePct * 10) / 10,
      segments: segments.map((seg) => ({
        urbanRural: seg.urbanRural,
        tribal: seg.tribal,
        total: seg.population.total,
        noCoverage: seg.population.noCoverage,
        unservedPct: Math.round(seg.unservedPct * 10) / 10,
      })),
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
  },
});
