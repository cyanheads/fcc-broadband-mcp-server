/**
 * @fileoverview Tests for the fcc_geocode_block tool.
 * @module tests/tools/geocode-block.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geocodeBlockTool } from '@/mcp-server/tools/definitions/geocode-block.tool.js';

const mockFindBlock = vi.fn();

vi.mock('@/services/geo-api/geo-api-service.js', () => ({
  getGeoApiService: () => ({ findBlock: mockFindBlock }),
}));

const SEATTLE_BLOCK: ReturnType<typeof geocodeBlockTool.output.parse> = {
  blockFips: '530330081021016',
  countyFips: '53033',
  countyName: 'King',
  stateFips: '53',
  stateCode: 'WA',
  stateName: 'Washington',
};

describe('geocodeBlockTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindBlock.mockResolvedValue(SEATTLE_BLOCK);
  });

  it('returns block location for valid coordinates', async () => {
    const ctx = createMockContext();
    const input = geocodeBlockTool.input.parse({ latitude: 47.6062, longitude: -122.3321 });
    const result = await geocodeBlockTool.handler(input, ctx);
    expect(result).toMatchObject({
      blockFips: '530330081021016',
      countyFips: '53033',
      countyName: 'King',
      stateCode: 'WA',
    });
    expect(mockFindBlock).toHaveBeenCalledWith(47.6062, -122.3321, ctx);
  });

  it('throws block_not_found when service returns null (no block at coordinates)', async () => {
    mockFindBlock.mockResolvedValue(null);
    const ctx = createMockContext({ errors: geocodeBlockTool.errors });
    const input = geocodeBlockTool.input.parse({ latitude: 0, longitude: 0 });
    await expect(geocodeBlockTool.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'block_not_found' },
    });
  });

  it('formats output with blockFips, county, and state', () => {
    const blocks = geocodeBlockTool.format!(SEATTLE_BLOCK);
    expect(blocks.length).toBeGreaterThan(0);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('530330081021016');
    expect(text).toContain('King');
    expect(text).toContain('Washington');
    expect(text).toContain('WA');
    expect(text).toContain('53033');
    expect(text).toContain('53');
  });
});
