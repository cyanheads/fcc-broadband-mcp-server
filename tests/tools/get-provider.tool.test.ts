/**
 * @fileoverview Tests for the fcc_get_provider tool.
 * @module tests/tools/get-provider.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderTool } from '@/mcp-server/tools/definitions/get-provider.tool.js';

const mockGetProviderSummary = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ getProviderSummary: mockGetProviderSummary }),
}));

/** Comcast Corporation's live tech=all national population figures. */
const MOCK_SUMMARY = {
  hoconum: '130317',
  holdingCompanyName: 'Comcast Corporation',
  techCodes: ['41', '50'],
  speedTierPopulation: {
    d_1: 0,
    d_2: 0,
    d_3: 0,
    d_4: 120819661,
    d_5: 120686133,
    d_6: 118750429,
    d_7: 118706136,
    d_8: 118706136,
  },
};

describe('getProviderTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderSummary.mockResolvedValue(MOCK_SUMMARY);
  });

  describe('hoconum input validation', () => {
    it('accepts a numeric hoconum', () => {
      expect(getProviderTool.input.parse({ hoconum: '130317' })).toEqual({ hoconum: '130317' });
    });

    it.each([
      ['non-numeric', 'not-a-number'],
      ['quote-bearing', "x'"],
      ['empty', ''],
      ['whitespace-padded', ' 130317 '],
      ['SoQL injection attempt', "130317' OR '1'='1"],
    ])('rejects a %s hoconum before the service is reached', (_label, hoconum) => {
      expect(() => getProviderTool.input.parse({ hoconum })).toThrow();
      expect(mockGetProviderSummary).not.toHaveBeenCalled();
    });
  });

  it('returns provider profile for a valid hoconum', async () => {
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130317' });
    const result = await getProviderTool.handler(input, ctx);
    expect(result.hoconum).toBe('130317');
    expect(result.holdingCompanyName).toBe('Comcast Corporation');
    expect(result.techCodes).toEqual(['41', '50']);
    expect(result.techLabels).toEqual(['Cable modem (DOCSIS 1, 1.1, 2.0)', 'Fiber to premises']);
  });

  it('labels every FCC deployment technology code the provider reports', async () => {
    mockGetProviderSummary.mockResolvedValue({
      ...MOCK_SUMMARY,
      techCodes: ['0', '20', '30', '42', '43', '90'],
    });
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130317' });
    const result = await getProviderTool.handler(input, ctx);
    expect(result.techLabels).toEqual([
      'All other',
      'DSL (symmetric xDSL)',
      'Other copper wireline',
      'Cable modem (DOCSIS 3.0)',
      'Cable modem (DOCSIS 3.1)',
      'Electric power line',
    ]);
  });

  it('labels speed tiers with the FCC published thresholds', async () => {
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130317' });
    const result = await getProviderTool.handler(input, ctx);
    expect(result.speedTierPopulation).toEqual([
      { tier: '25 Mbps', population: 120819661 },
      { tier: '100 Mbps', population: 120686133 },
      { tier: '250 Mbps', population: 118750429 },
      { tier: '500 Mbps', population: 118706136 },
      { tier: '1000 Mbps', population: 118706136 },
    ]);
  });

  it('filters zero-count speed tiers from speedTierPopulation', async () => {
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130317' });
    const result = await getProviderTool.handler(input, ctx);
    // d_1, d_2, d_3 are 0 and should be filtered out
    expect(result.speedTierPopulation.some((t) => t.population === 0)).toBe(false);
    expect(result.speedTierPopulation.length).toBe(5);
  });

  it('returns an empty profile body when the provider reports no national coverage', async () => {
    mockGetProviderSummary.mockResolvedValue({
      hoconum: '130982',
      holdingCompanyName: 'Zayo Group, LLC',
      techCodes: [],
      speedTierPopulation: {},
    });
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130982' });
    const result = await getProviderTool.handler(input, ctx);
    expect(result.holdingCompanyName).toBe('Zayo Group, LLC');
    expect(result.techCodes).toEqual([]);
    expect(result.techLabels).toEqual([]);
    expect(result.speedTierPopulation).toEqual([]);
  });

  it('throws provider_not_found when service returns null', async () => {
    mockGetProviderSummary.mockResolvedValue(null);
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '999999' });
    await expect(getProviderTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'provider_not_found' },
    });
  });

  it('formats output with hoconum, company name, tech labels, and speed tiers', () => {
    const output = {
      hoconum: '130317',
      holdingCompanyName: 'Comcast Corporation',
      techCodes: ['41', '50'],
      techLabels: ['Cable modem (DOCSIS 1, 1.1, 2.0)', 'Fiber to premises'],
      speedTierPopulation: [
        { tier: '25 Mbps', population: 120819661 },
        { tier: '100 Mbps', population: 120686133 },
      ],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getProviderTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130317');
    expect(text).toContain('Comcast Corporation');
    expect(text).toContain('Cable modem');
    expect(text).toContain('Fiber');
    expect(text).toContain('120,819,661');
    expect(text).toContain('25 Mbps');
    expect(text).toContain('Population');
    expect(text).not.toContain('Locations');
  });

  it('formats the no-national-coverage case without an empty coverage table', () => {
    const output = {
      hoconum: '130982',
      holdingCompanyName: 'Zayo Group, LLC',
      techCodes: [],
      techLabels: [],
      speedTierPopulation: [],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getProviderTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130982');
    expect(text).toContain('Zayo Group, LLC');
    expect(text).toContain('No national population coverage');
    expect(text).not.toContain('| Speed Tier |');
  });

  it('handles sparse speed tier data — no zero tiers in output', () => {
    const output = {
      hoconum: '130317',
      holdingCompanyName: 'Comcast Corporation',
      techCodes: ['50'],
      techLabels: ['Fiber to premises'],
      speedTierPopulation: [],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getProviderTool.format!(output);
    expect(blocks.length).toBeGreaterThan(0);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130317');
  });
});
