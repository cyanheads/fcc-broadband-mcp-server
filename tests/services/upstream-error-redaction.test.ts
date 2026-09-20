/**
 * @fileoverview Guards that a non-2xx upstream response never puts the request
 * URL on the error a caller receives.
 *
 * `error.data` is forwarded to the client as `structuredContent.error.data`,
 * and every request URL this server builds carries something that must not go
 * there: the Socrata app token rides in the Open Data query string, and the
 * Geo and BDC URLs carry the caller's own coordinates and filters. The
 * framework's `httpErrorFromResponse` omits the URL unless asked for it, so the
 * guard is that no call site here ever passes `includeUrl: true` — a one-word
 * change with no other visible effect, which is exactly the kind that survives
 * review.
 * @module tests/services/upstream-error-redaction.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import { BdcApiService } from '@/services/bdc-api/bdc-api-service.js';
import { GeoApiService } from '@/services/geo-api/geo-api-service.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';

const APP_TOKEN = 'socrata-app-token-value';
const BDC_HASH = 'bdc-hash-value';

const serverConfig: ServerConfig = {
  bdcUsername: 'ops@example.gov',
  bdcHashValue: BDC_HASH,
  opendataAppToken: APP_TOKEN,
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

const config = {} as AppConfig;
const storage = {} as StorageService;

/** Every URL the run requested, so the token's presence in one is provable. */
function captureFetch(status: number): { mock: ReturnType<typeof vi.fn>; urls: string[] } {
  const urls: string[] = [];
  const mock = vi.fn((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response('upstream rejected the request', { status }));
  });
  return { mock, urls };
}

/** Run `call`, expect it to reject, and hand back the McpError it threw. */
async function rejection(call: () => Promise<unknown>): Promise<McpError> {
  try {
    await call();
  } catch (error) {
    return error as McpError;
  }
  throw new Error('expected the call to reject');
}

describe('upstream error redaction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('omits the Open Data request URL, which carries the Socrata app token', async () => {
    const { mock, urls } = captureFetch(403);
    vi.stubGlobal('fetch', mock);

    const error = await rejection(() =>
      new OpenDataService(config, storage, serverConfig).getGeographyName(
        'state',
        '53',
        createMockContext(),
      ),
    );

    // The token really is in the URL — the omission is what keeps it off the wire.
    expect(urls[0]).toContain(APP_TOKEN);
    expect(error.data).not.toHaveProperty('url');
    expect(JSON.stringify(error.data ?? {})).not.toContain(APP_TOKEN);
  });

  it('omits the Geo API request URL', async () => {
    // A 4xx everywhere here: `withRetry` treats 5xx as transient, and the
    // backoff between attempts is real time, not the assertion under test.
    const { mock, urls } = captureFetch(404);
    vi.stubGlobal('fetch', mock);

    const error = await rejection(() =>
      new GeoApiService(config, storage).findBlock(47.6062, -122.3321, createMockContext()),
    );

    expect(urls[0]).toContain('latitude=47.6062');
    expect(error.data).not.toHaveProperty('url');
    expect(JSON.stringify(error.data ?? {})).not.toContain('47.6062');
  });

  it('omits the BDC request URL and never echoes the credential header', async () => {
    const { mock } = captureFetch(401);
    vi.stubGlobal('fetch', mock);

    const error = await rejection(() =>
      new BdcApiService(config, storage, serverConfig).listFilingPeriods(
        { includeBdc: true },
        createMockContext(),
      ),
    );

    expect(error.data).not.toHaveProperty('url');
    expect(JSON.stringify(error.data ?? {})).not.toContain(BDC_HASH);
  });

  it('still names the upstream service so the caller knows who failed', async () => {
    const { mock } = captureFetch(404);
    vi.stubGlobal('fetch', mock);

    const error = await rejection(() =>
      new GeoApiService(config, storage).findBlock(47.6062, -122.3321, createMockContext()),
    );

    expect(error.message).toContain('FCC Geo API');
  });
});
