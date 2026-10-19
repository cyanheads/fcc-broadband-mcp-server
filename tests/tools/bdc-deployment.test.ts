/**
 * @fileoverview Credential availability through real filing-period contracts.
 * @module tests/tools/bdc-deployment.test
 */
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { createInMemoryStorage, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  [undefined, undefined],
  ['ops@example.gov', undefined],
  [undefined, 'hash'],
  ['', 'hash'],
  ['ops@example.gov', '   '],
  [`${'$'}{user_config.username}`, 'hash'],
  ['ops@example.gov', `${'$'}{user_config.hash}`],
])('returns Form 477 without download suggestions for %j / %j', async (username, hash) => {
  vi.stubEnv('FCC_BDC_USERNAME', username);
  vi.stubEnv('FCC_BDC_HASH_VALUE', hash);
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  const { initBdcApiService } = await import('@/services/bdc-api/bdc-api-service.js');
  const { listFilingPeriodsTool } = await import(
    '@/mcp-server/tools/definitions/list-filing-periods.tool.js'
  );
  initBdcApiService({} as AppConfig, createInMemoryStorage(), getServerConfig());
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const result = await runToolContract(listFilingPeriodsTool, { include_bdc: true });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    hasBdcCredentials: false,
    bdcCount: 0,
    form477Count: 13,
  });
  expect(listFilingPeriodsTool.output.parse(result.structuredContent).dataNote).not.toContain(
    'fcc_list_downloads',
  );
  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  expect(text).toContain('2021-06-30');
  expect(text).toContain('Not configured');
  expect(text).not.toContain('fcc_list_downloads');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reports the parsed credentials even if the raw environment changes after startup', async () => {
  vi.stubEnv('FCC_BDC_USERNAME', 'ops@example.gov');
  vi.stubEnv('FCC_BDC_HASH_VALUE', 'hash');
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  const { initBdcApiService } = await import('@/services/bdc-api/bdc-api-service.js');
  const { listFilingPeriodsTool } = await import(
    '@/mcp-server/tools/definitions/list-filing-periods.tool.js'
  );
  initBdcApiService({} as AppConfig, createInMemoryStorage(), getServerConfig());
  vi.stubEnv('FCC_BDC_USERNAME', undefined);
  vi.stubEnv('FCC_BDC_HASH_VALUE', undefined);
  const result = await runToolContract(listFilingPeriodsTool, { include_bdc: false });
  expect(result.structuredContent).toMatchObject({ hasBdcCredentials: true, bdcCount: 0 });
  expect(listFilingPeriodsTool.output.parse(result.structuredContent).dataNote).toContain(
    'fcc_list_downloads',
  );
  expect(result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('Configured') }),
    ]),
  );
});
