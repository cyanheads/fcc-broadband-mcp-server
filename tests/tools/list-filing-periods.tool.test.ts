/**
 * @fileoverview Tests for the fcc_list_filing_periods tool.
 * @module tests/tools/list-filing-periods.tool.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFilingPeriodsTool } from '@/mcp-server/tools/definitions/list-filing-periods.tool.js';
import { FORM477_PERIODS as ALL_FORM477_PERIODS } from '@/services/bdc-api/types.js';

const mockListFilingPeriods = vi.fn();

vi.mock('@/services/bdc-api/bdc-api-service.js', () => ({
  getBdcApiService: () => ({ listFilingPeriods: mockListFilingPeriods }),
}));

const FORM477_PERIODS = [
  { asOfDate: '2021-06-30', source: 'form477' as const },
  { asOfDate: '2020-12-31', source: 'form477' as const },
  { asOfDate: '2020-06-30', source: 'form477' as const },
];

describe('listFilingPeriodsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFilingPeriods.mockResolvedValue(FORM477_PERIODS);
  });

  it('returns form477 periods sorted newest first', async () => {
    const ctx = createMockContext();
    const input = listFilingPeriodsTool.input.parse({ include_bdc: false });
    const result = await listFilingPeriodsTool.handler(input, ctx);
    expect(result.periods[0]!.asOfDate).toBe('2021-06-30');
    expect(result.form477Count).toBe(3);
    expect(result.bdcCount).toBe(0);
  });

  it('returns both form477 and bdc periods when include_bdc=true', async () => {
    mockListFilingPeriods.mockResolvedValue([
      ...FORM477_PERIODS,
      { asOfDate: '2024-06-30', source: 'bdc' as const },
    ]);
    const ctx = createMockContext();
    const input = listFilingPeriodsTool.input.parse({ include_bdc: true });
    const result = await listFilingPeriodsTool.handler(input, ctx);
    expect(result.form477Count).toBe(3);
    expect(result.bdcCount).toBe(1);
    expect(result.periods[0]!.asOfDate).toBe('2024-06-30');
  });

  it('passes includeBdc flag to service', async () => {
    const ctx = createMockContext();
    const input = listFilingPeriodsTool.input.parse({ include_bdc: true });
    await listFilingPeriodsTool.handler(input, ctx);
    expect(mockListFilingPeriods).toHaveBeenCalledWith({ includeBdc: true }, ctx);
  });

  it('discloses all supported and unsupported area filings on both surfaces', async () => {
    mockListFilingPeriods.mockResolvedValue([
      ...ALL_FORM477_PERIODS,
      { asOfDate: '2024-06-30', source: 'bdc', publicationDate: '2024-09-01' },
    ]);
    const result = await runToolContract(listFilingPeriodsTool, { include_bdc: true });
    const periods = listFilingPeriodsTool.output.parse(result.structuredContent).periods;
    expect(
      periods.filter((period) => period.areaCoverageAvailable).map(({ asOfDate }) => asOfDate),
    ).toEqual([
      '2021-06-30',
      '2020-12-31',
      '2020-06-30',
      '2019-12-31',
      '2019-06-30',
      '2018-12-31',
      '2018-06-30',
      '2017-12-31',
      '2017-06-30',
      '2016-12-31',
    ]);
    expect(
      periods
        .filter((period) => period.areaCoverageAvailable === false)
        .map(({ asOfDate }) => asOfDate),
    ).toEqual(['2016-06-30', '2015-12-31', '2015-06-30']);
    expect(periods[0]).not.toHaveProperty('areaCoverageAvailable');
    const rendered = JSON.stringify(result.content);
    expect(rendered).toContain('| 2016-12-31 | Form 477 | — | Yes |');
    expect(rendered).toContain('| 2016-06-30 | Form 477 | — | No |');
    expect(rendered).toContain('| 2024-06-30 | BDC | 2024-09-01 | — |');
  });

  it('defaults include_bdc to false', async () => {
    const ctx = createMockContext();
    const input = listFilingPeriodsTool.input.parse({});
    await listFilingPeriodsTool.handler(input, ctx);
    expect(mockListFilingPeriods).toHaveBeenCalledWith({ includeBdc: false }, ctx);
  });

  it('formats output with periods table and credential status', () => {
    const output = {
      periods: [
        { asOfDate: '2021-06-30', source: 'form477' as const },
        { asOfDate: '2024-06-30', source: 'bdc' as const, publicationDate: '2024-09-01' },
      ],
      form477Count: 1,
      bdcCount: 1,
      hasBdcCredentials: false,
      dataNote: 'Form 477 data available without credentials.',
    };
    const blocks = listFilingPeriodsTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('2021-06-30');
    expect(text).toContain('2024-06-30');
    expect(text).toContain('Form 477');
    expect(text).toContain('BDC');
    expect(text).toContain('2024-09-01');
    expect(text).toContain('1');
  });
});
