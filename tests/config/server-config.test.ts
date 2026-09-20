/**
 * @fileoverview Tests for the server's own env-var configuration.
 *
 * The schema leans on the framework's env normalization rather than carrying
 * its own guard: an empty, whitespace-only, or unsubstituted `${…}` value —
 * all three of which a bundle or compose template can hand a server whose
 * operator left an optional field blank — has to read as "unset" so a defaulted
 * field takes its default and an optional field stays undefined. A regression
 * there is a startup crash on a deployment that configured nothing, so the
 * behavior is pinned here rather than inferred from the schema.
 * @module tests/config/server-config.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';

const FCC_ENV_VARS = [
  'FCC_BDC_USERNAME',
  'FCC_BDC_HASH_VALUE',
  'FCC_OPENDATA_APP_TOKEN',
  'FCC_MIRROR_ENABLED',
  'FCC_MIRROR_PATH',
] as const;

/** A `$`, assembled rather than written, so the references below stay data. */
const DOLLAR = '$';

/**
 * The literal `${…}` reference an install host forwards when nothing
 * substituted it — what an MCPB bundle or plugin manifest sends for an option
 * the operator left blank.
 */
function unsubstituted(reference: string): string {
  return `${DOLLAR}{${reference}}`;
}

/**
 * Parse the config fresh under `env`. `getServerConfig` memoizes on first call,
 * so each case needs its own module instance.
 */
async function loadConfig(env: Partial<Record<string, string>> = {}): Promise<ServerConfig> {
  for (const name of FCC_ENV_VARS) vi.stubEnv(name, env[name]);
  vi.resetModules();
  const { getServerConfig } = await import('@/config/server-config.js');
  return getServerConfig();
}

describe('getServerConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('mirrorPath', () => {
    it('defaults when the variable is unset', async () => {
      expect((await loadConfig()).mirrorPath).toBe('data/fcc-mirror');
    });

    it.each([
      ['empty', ''],
      ['whitespace-only', '   '],
      ['an unsubstituted placeholder', unsubstituted('FCC_MIRROR_PATH')],
      ['an unsubstituted user_config placeholder', unsubstituted('user_config.FCC_MIRROR_PATH')],
    ])('defaults when the variable is %s', async (_label, value) => {
      expect((await loadConfig({ FCC_MIRROR_PATH: value })).mirrorPath).toBe('data/fcc-mirror');
    });

    it('keeps a configured path verbatim', async () => {
      expect((await loadConfig({ FCC_MIRROR_PATH: '/srv/fcc' })).mirrorPath).toBe('/srv/fcc');
    });

    it('keeps a path that merely contains a placeholder', async () => {
      // Only a whole-value `${…}` reads as unset — a substitution the host did
      // perform can leave braces inside a longer path.
      const path = `/srv/${unsubstituted('env')}/fcc`;
      expect((await loadConfig({ FCC_MIRROR_PATH: path })).mirrorPath).toBe(path);
    });
  });

  describe('credentials', () => {
    it('leaves every optional credential undefined when unset', async () => {
      const config = await loadConfig();
      expect(config.bdcUsername).toBeUndefined();
      expect(config.bdcHashValue).toBeUndefined();
      expect(config.opendataAppToken).toBeUndefined();
    });

    it.each([
      ['empty', ''],
      ['an unsubstituted placeholder', unsubstituted('user_config.FCC_BDC_USERNAME')],
    ])('reads a %s credential as absent rather than as a blank value', async (_label, value) => {
      // The plugin and bundle manifests ship `"default": ""` for every optional
      // option, so a blank is what an operator who configured nothing sends.
      const config = await loadConfig({ FCC_BDC_USERNAME: value });
      expect(config.bdcUsername).toBeUndefined();
    });

    it('keeps a configured credential', async () => {
      const config = await loadConfig({ FCC_BDC_USERNAME: 'ops@example.gov' });
      expect(config.bdcUsername).toBe('ops@example.gov');
    });
  });

  describe('mirrorEnabled', () => {
    it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])('enables on %s', async (value) => {
      expect((await loadConfig({ FCC_MIRROR_ENABLED: value })).mirrorEnabled).toBe(true);
    });

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['false', 'false'],
      ['0', '0'],
      ['off', 'off'],
      ['an unsubstituted placeholder', unsubstituted('user_config.FCC_MIRROR_ENABLED')],
    ])('stays off on %s', async (_label, value) => {
      const config = await loadConfig(
        value === undefined ? {} : { FCC_MIRROR_ENABLED: value as string },
      );
      expect(config.mirrorEnabled).toBe(false);
    });
  });
});
