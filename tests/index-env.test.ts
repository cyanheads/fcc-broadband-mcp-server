/**
 * @fileoverview Real .env loading before deployment credential decisions.
 * @module tests/index-env.test
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const { createApp } = vi.hoisted(() => ({
  createApp: vi.fn<typeof import('@cyanheads/mcp-ts-core').createApp>(),
}));
vi.mock('@cyanheads/mcp-ts-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createApp,
}));

it('loads .env credentials before server config is cached and respects process-env precedence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fcc-credentials-'));
  const envFile = join(directory, '.env');
  writeFileSync(envFile, 'FCC_BDC_USERNAME=file@example.gov\nFCC_BDC_HASH_VALUE=file-hash\n');
  vi.stubEnv('FCC_BDC_USERNAME', 'process@example.gov');
  vi.stubEnv('FCC_BDC_HASH_VALUE', undefined);
  const loadEnvFile = process.loadEnvFile;
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => loadEnvFile(envFile));
  try {
    await import('@/index.js');
    expect(process.loadEnvFile).toHaveBeenCalled();
    const { getServerConfig } = await import('@/config/server-config.js');
    expect(getServerConfig()).toMatchObject({
      bdcUsername: 'process@example.gov',
      bdcHashValue: 'file-hash',
    });
    const app = createApp.mock.calls[0]![0]!;
    expect(app.tools!.find((tool) => tool.name === 'fcc_list_downloads')).not.toHaveProperty(
      '__mcpDisabled',
    );
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true });
  }
});
