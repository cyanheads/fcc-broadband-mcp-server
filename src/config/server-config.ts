/**
 * @fileoverview Server-specific environment variable configuration for fcc-broadband-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  bdcUsername: z
    .string()
    .optional()
    .describe(
      'FCC account email for BDC API. Required for fcc_list_downloads and BDC filing periods.',
    ),
  bdcHashValue: z
    .string()
    .optional()
    .describe('API token hash from broadbandmap.fcc.gov "Manage API Access" page.'),
  opendataAppToken: z
    .string()
    .optional()
    .describe('Socrata app token for FCC Open Data. Increases rate limits; not required.'),
  // Opt-in local SQLite mirror of the frozen Form 477 corpus. Off by default —
  // when disabled, every Form 477 tool behaves exactly as before (live Socrata).
  mirrorEnabled: z
    .preprocess(
      (v) =>
        typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : false,
      z.boolean(),
    )
    .describe(
      'Serve Form 477 queries from a local SQLite mirror when its coverage allows (bootstrap with `bun run mirror:init`). Default: false.',
    ),
  // Empty or whitespace-only values (an unfilled `${FCC_MIRROR_PATH}` placeholder
  // from a bundle/compose template) are treated as absent so startup never crashes.
  mirrorPath: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().min(1).default('data/fcc-mirror'),
    )
    .describe('Directory holding the mirror SQLite files. Default: data/fcc-mirror.'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    bdcUsername: 'FCC_BDC_USERNAME',
    bdcHashValue: 'FCC_BDC_HASH_VALUE',
    opendataAppToken: 'FCC_OPENDATA_APP_TOKEN',
    mirrorEnabled: 'FCC_MIRROR_ENABLED',
    mirrorPath: 'FCC_MIRROR_PATH',
  });
  return _config;
}
