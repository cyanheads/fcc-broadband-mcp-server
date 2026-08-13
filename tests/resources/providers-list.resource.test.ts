/**
 * @fileoverview Tests for the fcc-broadband://providers/list resource.
 * @module tests/resources/providers-list.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providersListResource } from '@/mcp-server/resources/definitions/providers-list.resource.js';

const mockListAllProviders = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({ listAllProviders: mockListAllProviders }),
}));

const MOCK_PROVIDERS = [{ hoconum: '130152' }, { hoconum: '130000' }, { hoconum: '200001' }];

describe('providersListResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAllProviders.mockResolvedValue(MOCK_PROVIDERS);
  });

  // Happy path
  it('returns all providers with correct count', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(result.providers).toHaveLength(3);
    expect(result.count).toBe(3);
    expect(result.providers[0]!.hoconum).toBe('130152');
  });

  it('includes dataVintage in output', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(typeof result.dataVintage).toBe('string');
    expect(result.dataVintage).toContain('2021');
  });

  it('includes usage notice about resolving names', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(typeof result.notice).toBe('string');
    expect(result.notice.length).toBeGreaterThan(0);
  });

  // Empty result
  it('handles empty provider list gracefully', async () => {
    mockListAllProviders.mockResolvedValue([]);
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(result.providers).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  // count matches providers array length
  it('count equals providers array length', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(result.count).toBe(result.providers.length);
  });

  // Service called with ctx
  it('forwards ctx to the service', async () => {
    const ctx = createMockContext();
    await providersListResource.handler({}, ctx);
    expect(mockListAllProviders).toHaveBeenCalledWith(ctx);
  });

  // Service error propagates
  it('propagates service errors', async () => {
    mockListAllProviders.mockRejectedValue(new Error('upstream unavailable'));
    const ctx = createMockContext();
    await expect(providersListResource.handler({}, ctx)).rejects.toThrow('upstream unavailable');
  });

  // Large dataset count accuracy
  it('handles large provider lists and counts accurately', async () => {
    const bigList = Array.from({ length: 500 }, (_, i) => ({
      hoconum: String(i).padStart(6, '0'),
    }));
    mockListAllProviders.mockResolvedValue(bigList);
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    expect(result.count).toBe(500);
    expect(result.providers).toHaveLength(500);
  });

  // Security — output does not expose secrets
  it('does not expose environment variable names in output', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/API_KEY/i);
    expect(serialized).not.toMatch(/FCC_BDC/i);
    expect(serialized).not.toMatch(/PASSWORD/i);
  });

  // Hoconum values are strings
  it('returns hoconum values as strings', async () => {
    const ctx = createMockContext();
    const result = await providersListResource.handler({}, ctx);
    for (const p of result.providers) {
      expect(typeof p.hoconum).toBe('string');
    }
  });
});
