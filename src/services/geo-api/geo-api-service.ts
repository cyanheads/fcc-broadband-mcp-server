/**
 * @fileoverview FCC Geo API service — converts lat/lon to census block FIPS codes.
 * Wraps the public FCC Geo API at geo.fcc.gov/api/census. No auth required.
 * @module services/geo-api/geo-api-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type { BlockLocation, GeoApiBlockResponse } from './types.js';

const BASE_URL = 'https://geo.fcc.gov/api/census';
const TIMEOUT_MS = 15_000;

export class GeoApiService {
  constructor(
    readonly config: AppConfig,
    readonly storage: StorageService,
  ) {}

  /**
   * Converts a lat/lon coordinate to census block FIPS and geographic identifiers.
   * Returns null when no block exists at the given coordinates (over water, outside US coverage).
   */
  findBlock(latitude: number, longitude: number, ctx: Context): Promise<BlockLocation | null> {
    return withRetry(
      async () => {
        const url = `${BASE_URL}/block/find?latitude=${latitude}&longitude=${longitude}&format=json`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const signal = ctx.signal
          ? AbortSignal.any([ctx.signal, controller.signal])
          : controller.signal;

        let response: Response;
        try {
          response = await fetch(url, { signal });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'FCC Geo API' });
        }

        const raw = (await response.json()) as GeoApiBlockResponse;

        if (raw.isError || !raw.Block?.FIPS) {
          return null;
        }

        const blockFips = raw.Block.FIPS;
        const countyFips = raw.County?.FIPS ?? '';
        const countyName = raw.County?.name ?? '';
        const stateFips = raw.State?.FIPS ?? '';
        const stateCode = raw.State?.code ?? '';
        const stateName = raw.State?.name ?? '';

        if (blockFips.length !== 15) {
          throw serviceUnavailable(
            `FCC Geo API returned invalid block FIPS "${blockFips}" — expected 15 digits`,
            { latitude, longitude, blockFips },
          );
        }

        ctx.log.debug('GeoApiService.findBlock succeeded', {
          blockFips,
          countyFips,
          stateFips,
        });

        return { blockFips, countyFips, countyName, stateFips, stateCode, stateName };
      },
      {
        operation: 'GeoApiService.findBlock',
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }
}

// --- Init/accessor pattern ---

let _service: GeoApiService | undefined;

export function initGeoApiService(config: AppConfig, storage: StorageService): void {
  _service = new GeoApiService(config, storage);
}

export function getGeoApiService(): GeoApiService {
  if (!_service) {
    throw new Error('GeoApiService not initialized — call initGeoApiService() in setup()');
  }
  return _service;
}
