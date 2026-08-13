/**
 * @fileoverview Tests for OpenDataService — live Socrata query plumbing:
 * timeout classification at the fetch choke point, retry behavior, the grouped
 * provider-search query shape (issue #14), and complete-vs-truncated raw row
 * scans behind getAreaStatsByType (issue #22).
 * @module tests/services/open-data/open-data-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import type { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import { MAX_SCAN_ROWS } from '@/services/open-data/mirror/stores.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';
import type { RawAreaRow } from '@/services/open-data/types.js';

const serverConfig: ServerConfig = {
  mirrorEnabled: false,
  mirrorPath: 'data/fcc-mirror',
};

function makeService(mirror?: Form477Mirror): OpenDataService {
  return new OpenDataService({} as AppConfig, {} as StorageService, serverConfig, mirror);
}

/** One Area Table row in the shape Socrata returns — every value a string. */
function areaRow(id: string, urbanRural: 'R' | 'U'): RawAreaRow {
  return {
    id,
    type: 'county',
    tech: 'acfosw',
    speed: '100',
    urban_rural: urbanRural,
    tribal_non: 'N',
    has_0: '1',
    has_1: '2',
    has_2: '0',
    has_3more: '0',
  };
}

/** Standing nationwide county scan — the query shape issue #22 was reported against. */
const NATIONWIDE_SCAN = {
  geographyType: 'county',
  techFilter: 'acfosw',
  speedDown: '100',
  urbanRuralFilter: 'all',
} as const;

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

  describe('getAreaStatsByType raw scan', () => {
    it('aggregates every page of a 6,262-row scan with two segments per county', async () => {
      // 3,131 counties × an R and a U segment — the live nationwide county
      // count, and well past the 5,000-row cap the tool used to impose.
      const rows = Array.from({ length: 3131 }, (_, i) => {
        const id = String(i + 1).padStart(5, '0');
        return [areaRow(id, 'R'), areaRow(id, 'U')];
      }).flat();

      const fetchMock = vi.fn((url: string) => {
        const params = new URL(url).searchParams;
        const offset = Number(params.get('$offset') ?? '0');
        const limit = Number(params.get('$limit') ?? '1000');
        return Promise.resolve(jsonResponse(JSON.stringify(rows.slice(offset, offset + limit))));
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().getAreaStatsByType(NATIONWIDE_SCAN, createMockContext());

      expect(result.stats).toHaveLength(3131);
      expect(result.scanTruncated).toBe(false);
      // Both segments folded into one county row: 2 × has_0, 2 × has_1.
      expect(result.stats[0]).toMatchObject({
        id: '00001',
        noCoverage: 2,
        oneProvider: 4,
        total: 6,
      });
      expect(fetchMock).toHaveBeenCalledTimes(7); // 6 full pages + a 262-row tail
    });

    it('reports scanTruncated when the live pager stops at the row ceiling', async () => {
      // Every page comes back full, so the pager never sees the end of the match.
      const fullPage = JSON.stringify(
        Array.from({ length: 1000 }, (_, i) => areaRow(String(i).padStart(5, '0'), 'R')),
      );
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fullPage));
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService().getAreaStatsByType(NATIONWIDE_SCAN, createMockContext());

      expect(result.scanTruncated).toBe(true);
      expect(result.scanRowCap).toBe(MAX_SCAN_ROWS);
      expect(fetchMock).toHaveBeenCalledTimes(MAX_SCAN_ROWS / 1000);
    });

    it('reports scanTruncated on the mirror path when rows fall short of the match', async () => {
      const partialMirror = {
        areaStatsByType: () =>
          Promise.resolve({ rows: [areaRow('11001', 'R')], total: MAX_SCAN_ROWS + 1 }),
      } as unknown as Form477Mirror;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await makeService(partialMirror).getAreaStatsByType(
        NATIONWIDE_SCAN,
        createMockContext(),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.scanTruncated).toBe(true);
      expect(result.stats).toHaveLength(1);
    });

    it('reports a complete mirror scan as untruncated', async () => {
      const wholeMirror = {
        areaStatsByType: () => Promise.resolve({ rows: [areaRow('11001', 'R')], total: 1 }),
      } as unknown as Form477Mirror;
      vi.stubGlobal('fetch', vi.fn());

      const result = await makeService(wholeMirror).getAreaStatsByType(
        NATIONWIDE_SCAN,
        createMockContext(),
      );

      expect(result.scanTruncated).toBe(false);
      expect(result.scanRowCap).toBe(MAX_SCAN_ROWS);
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
      const recovery = mcpError.data?.recovery as { hint: string } | undefined;
      expect(recovery?.hint).toContain('state filter');
      expect(recovery?.hint).toContain('FCC_MIRROR_ENABLED');
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
