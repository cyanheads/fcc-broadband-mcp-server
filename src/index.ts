#!/usr/bin/env node
/**
 * @fileoverview fcc-broadband-mcp-server MCP server entry point.
 * Provides access to FCC broadband availability, coverage analysis, and digital divide data
 * for US geographies and census blocks.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
import { allPromptDefinitions } from './mcp-server/prompts/definitions/index.js';
import { allResourceDefinitions } from './mcp-server/resources/definitions/index.js';
import { allToolDefinitions } from './mcp-server/tools/definitions/index.js';
import { initBdcApiService } from './services/bdc-api/bdc-api-service.js';
import { initGeoApiService } from './services/geo-api/geo-api-service.js';
import { initOpenDataService } from './services/open-data/open-data-service.js';

await createApp({
  name: 'fcc-broadband-mcp-server',
  title: 'fcc-broadband-mcp-server',
  tools: [...allToolDefinitions],
  resources: [...allResourceDefinitions],
  prompts: [...allPromptDefinitions],
  landing: { requireAuth: false },
  /*
   * Cache hints for protocol revision 2026-07-28. The definition arrays are
   * static and nothing mutates them at runtime, and no definition declares an
   * auth scope, so every caller is served the same listing — hence `public`.
   * Both resources read Form 477, a closed dataset final as of the June 2021
   * filing period, so a read stays fresh far longer than a listing.
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
  instructions:
    'FCC broadband data server providing access to Form 477 (2015–2021) and BDC (2022+) datasets.\n' +
    '- Start with fcc_geocode_block to convert coordinates to census block FIPS for address-level queries\n' +
    '- Use fcc_get_coverage_summary for equity/policy analysis at state, county, or national level\n' +
    '- Use fcc_find_underserved for BEAD program eligibility and funding analysis\n' +
    '- BDC tools (fcc_list_downloads) require FCC_BDC_USERNAME and FCC_BDC_HASH_VALUE credentials\n' +
    '- All Form 477 tools work without credentials and reflect data as of June 2021',
  setup(core) {
    const serverConfig = getServerConfig();
    initGeoApiService(core.config, core.storage);
    initOpenDataService(core.config, core.storage, serverConfig);
    initBdcApiService(core.config, core.storage, serverConfig);
  },
});
