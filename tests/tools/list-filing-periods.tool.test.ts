/**
 * @fileoverview Tests for the fcc_list_filing_periods tool.
 * @module tests/tools/list-filing-periods.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFilingPeriodsTool } from '@/mcp-server/tools/definitions/list-filing-periods.tool.js';

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
