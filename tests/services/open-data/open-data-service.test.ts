/**
 * @fileoverview Tests for OpenDataService — live Socrata query plumbing:
 * timeout classification at the fetch choke point, retry behavior, and the
 * grouped provider-search query shape (issue #14).
 * @module tests/services/open-data/open-data-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';

const serverConfig: ServerConfig = {
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

function makeService(): OpenDataService {
  return new OpenDataService({} as AppConfig, {} as StorageService, serverConfig);
}

/** fetch stub that never responds — rejects with AbortError when the signal fires. */
function abortingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        );
      }),
  );
}

function jsonResponse(body: string): { ok: boolean; text: () => Promise<string> } {
  return { ok: true, text: () => Promise.resolve(body) };
}

describe('OpenDataService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('searchProviders live query shape', () => {
    it('drops the 10x grouped-row multiplier when nameSearch is set', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);

      await makeService().searchProviders(
        { nameSearch: 'communications', limit: 50 },
        createMockContext(),
      );

      const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
      expect(url.searchParams.get('$limit')).toBe('50');
      expect(url.searchParams.get('$group')).toBe('hoconum,holdingcompanyname,stateabbr,techcode');
    });

    it('keeps the 10x grouped-row headroom when no nameSearch is given', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse('[]'));
      vi.stubGlobal('fetch', fetchMock);

      await makeService().searchProviders({ state: 'WA', limit: 50 }, createMockContext());

      const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
      expect(url.searchParams.get('$limit')).toBe('500');
    });
  });

  describe('timeout classification', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('fails the grouped provider search once on deadline — no retry amplification', async () => {
      const fetchMock = abortingFetch();
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService()
        .searchProviders({ nameSearch: 'communications' }, createMockContext())
        .then(
          () => {
            throw new Error('expected searchProviders to reject');
          },
          (error: unknown) => error,
        );

      // First deadline fires at 30s; run far past it to prove no further attempts.
      await vi.advanceTimersByTimeAsync(180_000);
      const error = await pending;

      expect(error).toBeInstanceOf(McpError);
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(JsonRpcErrorCode.Timeout);
      expect(mcpError.data?.retryable).toBe(false);
      expect(mcpError.data?.reason).toBe('live_search_timeout');
      expect((mcpError.data?.recovery as { hint: string }).hint).toContain('state filter');
      expect((mcpError.data?.recovery as { hint: string }).hint).toContain('FCC_MIRROR_ENABLED');
      // The whole point of issue #14: exactly one upstream attempt.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still retries a transient deadline on a cheap point query', async () => {
      let calls = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          });
        }
        return Promise.resolve(jsonResponse('[{"geoid":"53","type":"state","name":"Washington"}]'));
      });
      vi.stubGlobal('fetch', fetchMock);

      const pending = makeService().getGeographyName('state', '53', createMockContext());

      // 30s deadline aborts attempt 1, then backoff (~1.5s base ± jitter) precedes attempt 2.
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toBe('Washington');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
