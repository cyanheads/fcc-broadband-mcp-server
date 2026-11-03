#!/usr/bin/env node
/**
 * @fileoverview fcc-broadband-mcp-server MCP server entry point.
 * Provides access to FCC broadband availability, coverage analysis, and digital divide data
 * for US geographies and census blocks.
 * @module index
 */

import { createApp, disabledTool } from '@cyanheads/mcp-ts-core';
import { parseConfig } from '@cyanheads/mcp-ts-core/config';
import { getServerConfig } from './config/server-config.js';
import { allPromptDefinitions } from './mcp-server/prompts/definitions/index.js';
import { allResourceDefinitions } from './mcp-server/resources/definitions/index.js';
import { allToolDefinitions } from './mcp-server/tools/definitions/index.js';
import { initBdcApiService } from './services/bdc-api/bdc-api-service.js';
import { initGeoApiService } from './services/geo-api/geo-api-service.js';
import {
  closeOpenDataService,
  initOpenDataService,
} from './services/open-data/open-data-service.js';

parseConfig();
const serverConfig = getServerConfig();
const hasBdcCredentials = !!(serverConfig.bdcUsername && serverConfig.bdcHashValue);

await createApp({
  name: 'fcc-broadband-mcp-server',
  title: 'fcc-broadband-mcp-server',
  tools: allToolDefinitions.map((definition) =>
    definition.name === 'fcc_list_downloads' && !hasBdcCredentials
      ? disabledTool(definition, {
          reason: 'BDC credentials are not configured in this deployment.',
          hint: 'Set FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE to enable BDC downloads.',
        })
      : definition,
  ),
  resources: [...allResourceDefinitions],
  prompts: [...allPromptDefinitions],
  skills: 'skills',
  landing: { requireAuth: false },
  /*
   * No tool or resource handler calls `ctx.requestInput`, so nothing here needs
   * a session to answer a mid-handler prompt. Declared in source rather than
   * left to a deployment's `MCP_SESSION_MODE`, which still wins when it carries
   * a meaningful value.
   */
  sessionMode: 'stateless',
  /*
   * Cache hints for protocol revision 2026-07-28. The definition arrays are
   * static and nothing mutates them at runtime, and no definition declares an
   * auth scope, so every caller is served the same listing — hence `public`.
   * The domain resources read the closed June 2021 Form 477 dataset, and
   * the skill resources are static, so reads outlive listing cache entries.
   * 2025-era responses are unaffected.
   */
  cacheHints: {
    'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },
    'prompts/list': { ttlMs: 3_600_000, cacheScope: 'public' },
    'resources/list': { ttlMs: 3_600_000, cacheScope: 'public' },
    'resources/templates/list': { ttlMs: 3_600_000, cacheScope: 'public' },
    'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
    'resources/read': { ttlMs: 86_400_000, cacheScope: 'public' },
  },
  instructions: `FCC fixed broadband analysis uses keyless June 2021 Form 477 data. Resolve named geographies with fcc_search_geographies before coverage analysis; for location evidence, chain fcc_geocode_block to fcc_search_availability using its 2010-vintage blockFips, then use hoconum with fcc_get_provider for a national holding-company profile. Historical block coverage cannot establish current address service or funding eligibility. Area tools default to terrestrial coverage; their 100 Mbps tier is 100/10, not 100/20. ${hasBdcCredentials ? 'For newer BDC bulk-file manifests, call fcc_list_filing_periods with include_bdc=true before fcc_list_downloads; the credentialed API allows 10 calls per minute.' : 'BDC bulk-file manifests are unavailable in this deployment.'}`,
  setup(core) {
    initGeoApiService(core.config, core.storage);
    initOpenDataService(core.config, core.storage, serverConfig);
    initBdcApiService(core.config, core.storage, serverConfig);
  },
  /*
   * The Form 477 mirror is the only service holding an OS resource — one SQLite
   * file handle per store, opened lazily on the first mirrored read. The geo and
   * BDC services hold nothing beyond `fetch` calls bound to a request's signal.
   */
  teardown: closeOpenDataService,
});
