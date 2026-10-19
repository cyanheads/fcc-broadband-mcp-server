/**
 * @fileoverview Barrel export for all FCC broadband MCP tool definitions.
 * @module mcp-server/tools/definitions/index
 */

export { compareAreasTool } from './compare-areas.tool.js';
export { findUnderservedTool } from './find-underserved.tool.js';
export { geocodeBlockTool } from './geocode-block.tool.js';
export { getCoverageSummaryTool } from './get-coverage-summary.tool.js';
export { getProviderTool } from './get-provider.tool.js';
export { listDownloadsTool } from './list-downloads.tool.js';
export { listFilingPeriodsTool } from './list-filing-periods.tool.js';
export { searchAvailabilityTool } from './search-availability.tool.js';
export { searchGeographiesTool } from './search-geographies.tool.js';
export { searchProvidersTool } from './search-providers.tool.js';

import { compareAreasTool } from './compare-areas.tool.js';
import { findUnderservedTool } from './find-underserved.tool.js';
import { geocodeBlockTool } from './geocode-block.tool.js';
import { getCoverageSummaryTool } from './get-coverage-summary.tool.js';
import { getProviderTool } from './get-provider.tool.js';
import { listDownloadsTool } from './list-downloads.tool.js';
import { listFilingPeriodsTool } from './list-filing-periods.tool.js';
import { searchAvailabilityTool } from './search-availability.tool.js';
import { searchGeographiesTool } from './search-geographies.tool.js';
import { searchProvidersTool } from './search-providers.tool.js';

export const allToolDefinitions = [
  geocodeBlockTool,
  searchAvailabilityTool,
  searchGeographiesTool,
  getCoverageSummaryTool,
  searchProvidersTool,
  getProviderTool,
  compareAreasTool,
  findUnderservedTool,
  listFilingPeriodsTool,
  listDownloadsTool,
] as const;
