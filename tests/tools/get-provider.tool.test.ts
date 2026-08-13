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

const MOCK_SUMMARY = {
  hoconum: '130152',
  holdingCompanyName: 'Comcast',
  techCodes: ['41', '50'],
  speedTierLocations: {
    d_1: 0,
    d_2: 0,
    d_3: 0,
    d_4: 500000,
    d_5: 450000,
    d_6: 400000,
    d_7: 200000,
    d_8: 100000,
  },
};

describe('getProviderTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderSummary.mockResolvedValue(MOCK_SUMMARY);
  });

  it('returns provider profile for a valid hoconum', async () => {
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130152' });
    const result = await getProviderTool.handler(input, ctx);
    expect(result.hoconum).toBe('130152');
    expect(result.holdingCompanyName).toBe('Comcast');
    expect(result.techCodes).toContain('41');
    expect(result.techLabels).toContain('Cable modem (DOCSIS 3.0)');
  });

  it('filters zero-count speed tiers from speedTierLocations', async () => {
    const ctx = createMockContext({ errors: getProviderTool.errors });
    const input = getProviderTool.input.parse({ hoconum: '130152' });
    const result = await getProviderTool.handler(input, ctx);
    // d_1, d_2, d_3 are 0 and should be filtered out
    expect(result.speedTierLocations.some((t) => t.locationCount === 0)).toBe(false);
    expect(result.speedTierLocations.length).toBe(5);
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
      hoconum: '130152',
      holdingCompanyName: 'Comcast',
      techCodes: ['41', '50'],
      techLabels: ['Cable modem (DOCSIS 3.0)', 'Fiber to premises'],
      speedTierLocations: [
        { tier: '25 Mbps', locationCount: 500000 },
        { tier: '100 Mbps', locationCount: 400000 },
      ],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getProviderTool.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130152');
    expect(text).toContain('Comcast');
    expect(text).toContain('Cable modem');
    expect(text).toContain('Fiber');
    expect(text).toContain('500,000');
    expect(text).toContain('25 Mbps');
  });

  it('handles sparse speed tier data — no zero tiers in output', () => {
    const output = {
      hoconum: '130152',
      holdingCompanyName: 'Comcast',
      techCodes: ['50'],
      techLabels: ['Fiber to premises'],
      speedTierLocations: [],
      dataVintage: 'June 2021 (last Form 477 filing period)',
    };
    const blocks = getProviderTool.format!(output);
    expect(blocks.length).toBeGreaterThan(0);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('130152');
  });
});
