/**
 * @fileoverview Deployment catalog tests without starting a transport.
 * @module tests/index.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createApp } = vi.hoisted(() => ({
  createApp: vi.fn<typeof import('@cyanheads/mcp-ts-core').createApp>(),
}));
vi.mock('@cyanheads/mcp-ts-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createApp,
}));

async function deployment(username?: string, hash?: string) {
  vi.stubEnv('FCC_BDC_USERNAME', username);
  vi.stubEnv('FCC_BDC_HASH_VALUE', hash);
  vi.resetModules();
  await import('@/index.js');
  return createApp.mock.calls.at(-1)![0]!;
}

describe('deployment catalog', () => {
  beforeEach(() => {
    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('keeps the enabled downloads definition and its schema', async () => {
    const app = await deployment('ops@example.gov', 'hash');
    const downloads = app.tools!.find(
      (tool: { name: string }) => tool.name === 'fcc_list_downloads',
    );
    expect(downloads).toBeDefined();
    expect(downloads).not.toHaveProperty('__mcpDisabled');
    expect(downloads!.input.parse({ as_of_date: '2024-06-30' })).toMatchObject({
      as_of_date: '2024-06-30',
    });
    expect(app.landing).toEqual({ requireAuth: false });
  });

  it('initializes all service accessors and closes them through the captured lifecycle callbacks', async () => {
    vi.stubEnv('FCC_MIRROR_ENABLED', 'false');
    const app = await deployment('ops@example.gov', 'hash');
    const { parseConfig } = await import('@cyanheads/mcp-ts-core/config');
    const { createInMemoryStorage } = await import('@cyanheads/mcp-ts-core/testing');
    const geo = await import('@/services/geo-api/geo-api-service.js');
    const openData = await import('@/services/open-data/open-data-service.js');
    const bdc = await import('@/services/bdc-api/bdc-api-service.js');
    expect(() => geo.getGeoApiService()).toThrow('not initialized');
    expect(() => openData.getOpenDataService()).toThrow('not initialized');
    expect(() => bdc.getBdcApiService()).toThrow('not initialized');
    const core = {
      config: parseConfig(),
      storage: createInMemoryStorage(),
    } as Parameters<NonNullable<typeof app.setup>>[0];
    await app.setup!(core);
    expect(geo.getGeoApiService().storage).toBe(core.storage);
    expect(openData.getOpenDataService().storage).toBe(core.storage);
    expect(bdc.getBdcApiService().storage).toBe(core.storage);
    await app.teardown!(core);
    expect(app.sessionMode).toBe('stateless');
  });

  it.each([
    [undefined, undefined],
    ['ops@example.gov', undefined],
    [undefined, 'hash'],
    ['', 'hash'],
    ['ops@example.gov', '   '],
    [`${'$'}{user_config.username}`, 'hash'],
    ['ops@example.gov', `${'$'}{user_config.hash}`],
  ])('disables only downloads with credentials %j / %j', async (username, hash) => {
    const app = await deployment(username, hash);
    const disabled = app.tools!.filter((tool) => '__mcpDisabled' in tool);
    expect(disabled.map((tool: { name: string }) => tool.name)).toEqual(['fcc_list_downloads']);
    expect(disabled[0]).toHaveProperty(
      '__mcpDisabled.hint',
      expect.stringContaining('FCC_BDC_USERNAME'),
    );
    expect(app.instructions).not.toContain('fcc_list_downloads');
    expect(
      app.tools!.some((tool: { name: string }) => tool.name === 'fcc_list_filing_periods'),
    ).toBe(true);
  });
});
