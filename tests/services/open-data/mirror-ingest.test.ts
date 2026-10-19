/**
 * @fileoverview Form 477 ingest behavior at the HTTP and SQLite boundaries.
 * @module tests/services/open-data/mirror-ingest.test
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMirrorInit } from '@/services/open-data/mirror/ingest.js';
import { ALL_STATE_FIPS } from '@/services/open-data/mirror/state-fips.js';
import {
  closeForm477Stores,
  createForm477Stores,
  type Form477Stores,
  FULL_SCOPE,
  isCovered,
  listCovered,
  markCovered,
  stateScope,
} from '@/services/open-data/mirror/stores.js';

let dir: string;
let stores: Form477Stores;
const fetchMock = vi.fn<typeof fetch>();

function csv(text = 'sid\n'): Response {
  return new Response(text, { headers: { 'Content-Type': 'text/csv' } });
}

function requests(): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)));
}

async function completeSmallTables(): Promise<void> {
  for (const store of [stores.geography, stores.providerSummary]) {
    await store.writeState({ status: 'complete', completedAt: '2026-01-01T00:00:00Z' });
  }
}

async function expectIngestFailure(
  options: Parameters<typeof runMirrorInit>[0],
  message: string,
): Promise<void> {
  // Open real SQLite handles before advancing only the retry backoff clock.
  await Promise.all(Object.values(stores).map((store) => store.raw()));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const rejection = expect(runMirrorInit(options)).rejects.toThrow(message);
  await vi.runAllTimersAsync();
  await rejection;
  vi.useRealTimers();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fcc-ingest-test-'));
  stores = createForm477Stores(dir);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => csv());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await closeForm477Stores(stores);
  rmSync(dir, { recursive: true, force: true });
});

describe('runMirrorInit', () => {
  it('drains small tables before a state and persists mapped rows and distinct providers', async () => {
    fetchMock
      .mockResolvedValueOnce(csv('sid,geoid,type,name\ng1,11,state,"Washington, DC"\n'))
      .mockResolvedValueOnce(csv('sid,hoconum,tech,d_1\np1,100,all,30\n'))
      .mockResolvedValueOnce(
        csv(
          'sid,blockcode,hoconum,stateabbr,techcode,maxaddown,maxadup,holdingcompanyname\nd1,11001,100,DC,50,1000,invalid,Example\nd2,11002,100,DC,50,,10,Example\nd3,11003,,DC,50,25,3,Unknown\n',
        ),
      )
      .mockResolvedValueOnce(csv('sid,type,id,has_0\na1,county,11001,12\n'));

    await expect(
      runMirrorInit({ stores, states: ['11'], appToken: 'test-token', pageDelayMs: 0 }),
    ).resolves.toEqual({ full: false, statesIngested: ['11'], statesSkipped: [] });
    expect(requests().map((url) => url.pathname)).toEqual([
      '/resource/v5vt-e7vw.csv',
      '/resource/yd9y-6jqe.csv',
      '/resource/jdr4-3q4p.csv',
      '/resource/xvwq-qtaj.csv',
    ]);
    for (const url of requests()) {
      expect(url.origin).toBe('https://opendata.fcc.gov');
      expect(url.searchParams.get('$select')).toContain(':id as sid');
      expect(url.searchParams.get('$order')).toBe(':id');
      expect(url.searchParams.get('$limit')).toBe('50000');
      expect(url.searchParams.get('$offset')).toBe('0');
      expect(url.searchParams.get('$$app_token')).toBe('test-token');
    }
    expect(requests()[2]?.searchParams.get('$where')).toBe("stateabbr='DC'");
    expect(requests()[3]?.searchParams.get('$where')).toBe(
      "type in ('state','county','cd','place') AND id >= '11' AND id < '12'",
    );
    expect(await stores.deployment.getByIds(['d1', 'd2'])).toMatchObject([
      { maxaddown: 1000, maxadup: null, providername: '', consumer: '' },
      { maxaddown: null, maxadup: 10 },
    ]);
    expect(await stores.providerDim.count()).toBe(1);
    expect(await stores.providerDim.getByIds(['100|DC|50'])).toMatchObject([
      { holdingcompanyname: 'Example' },
    ]);
    expect(await stores.geography.getByIds(['g1'])).toMatchObject([{ name: 'Washington, DC' }]);
    expect(await stores.providerSummary.getByIds(['p1'])).toMatchObject([{ d_1: '30', d_8: '' }]);
    expect(await stores.area.getByIds(['a1'])).toMatchObject([
      { id: '11001', has_0: '12', has_1: '' },
    ]);
    expect(await listCovered(stores.deployment)).toEqual(['state:11']);
  });

  it('skips completed tables and covered states on subsequent runs', async () => {
    await runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 });
    fetchMock.mockClear();
    await expect(runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 })).resolves.toEqual({
      full: false,
      statesIngested: [],
      statesSkipped: ['11'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drains only small tables for an empty state list', async () => {
    await expect(runMirrorInit({ stores, states: [], pageDelayMs: 0 })).resolves.toEqual({
      full: false,
      statesIngested: [],
      statesSkipped: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await listCovered(stores.deployment)).toEqual([]);
    expect((await stores.geography.readState()).completedAt).toEqual(expect.any(String));
  });

  it('rejects invalid state FIPS before HTTP or persistence', async () => {
    await expect(runMirrorInit({ stores, states: ['11', '99'] })).rejects.toThrow(
      'Unknown state FIPS "99"',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listCovered(stores.deployment)).toEqual([]);
  });

  it('marks full coverage only after the national slice completes and skips it thereafter', async () => {
    await completeSmallTables();
    for (const fips of ALL_STATE_FIPS) await markCovered(stores.deployment, stateScope(fips));
    fetchMock.mockResolvedValueOnce(csv('sid,type,id\nn1,nation,0\n'));
    await expect(runMirrorInit({ stores, states: 'full', pageDelayMs: 0 })).resolves.toEqual({
      full: true,
      statesIngested: [],
      statesSkipped: [...ALL_STATE_FIPS],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requests()[0]?.searchParams.get('$where')).toBe("type in ('cbsa','tribal','nation')");
    expect(await isCovered(stores.deployment, FULL_SCOPE)).toBe(true);
    expect(await stores.area.getByIds(['n1'])).toMatchObject([{ type: 'nation', id: '0' }]);
    fetchMock.mockClear();
    expect((await runMirrorInit({ stores, states: 'full' })).full).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['matching', JSON.stringify({ scope: 'state:11', offset: 42 }), '42'],
    ['other scope', JSON.stringify({ scope: 'state:53', offset: 42 }), '0'],
    ['invalid JSON', '{broken', '0'],
    ['wrong offset type', JSON.stringify({ scope: 'state:11', offset: '42' }), '0'],
  ])('resumes a %s deployment cursor at the appropriate offset', async (_name, cursor, offset) => {
    await completeSmallTables();
    await stores.deployment.writeState({ status: 'error', cursor });
    await runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 });
    expect(requests()[0]?.searchParams.get('$offset')).toBe(offset);
    expect((await stores.deployment.readState()).cursor).toBeUndefined();
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(true);
  });

  it('resumes a small table and the area store independently', async () => {
    await stores.geography.writeState({
      status: 'error',
      cursor: JSON.stringify({ scope: 'fcc-477-geography', offset: 7 }),
    });
    await stores.area.writeState({
      status: 'error',
      cursor: JSON.stringify({ scope: 'state:11', offset: 9 }),
    });
    await runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 });
    expect(requests().map((url) => url.searchParams.get('$offset'))).toEqual(['7', '0', '0', '9']);
  });

  it('persists a full page before failure and resumes from that page on retry', async () => {
    await completeSmallTables();
    const fullPage = `sid\n${Array.from({ length: 50_000 }, (_, i) => `d${i}`).join('\n')}\n`;
    fetchMock.mockImplementation(async () => new Response('unavailable', { status: 400 }));
    fetchMock.mockResolvedValueOnce(csv(fullPage));
    await expectIngestFailure(
      { stores, states: ['11'], pageDelayMs: 0 },
      'FCC Open Data returned 400',
    );
    expect(requests()[0]?.searchParams.get('$offset')).toBe('0');
    expect(
      requests()
        .slice(1)
        .map((url) => url.searchParams.get('$offset')),
    ).toEqual(['50000', '50000', '50000', '50000']);
    expect(await stores.deployment.count()).toBe(50_000);
    expect(await stores.deployment.readState()).toMatchObject({
      status: 'error',
      cursor: JSON.stringify({ scope: 'state:11', offset: 50_000 }),
    });
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(false);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => csv());
    fetchMock.mockResolvedValueOnce(csv('sid\nlast\n')).mockResolvedValueOnce(csv());
    await runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 });
    expect(requests()[0]?.searchParams.get('$offset')).toBe('50000');
    expect(await stores.deployment.count()).toBe(50_001);
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(true);
  }, 30_000);

  it.each([
    ['missing row identity', 'blockcode\n11001\n', "without ':id as sid'"],
    ['malformed CSV', 'sid\n"unterminated', 'Malformed CSV'],
  ])(
    'does not mark a state covered after %s',
    async (_name, page, message) => {
      await completeSmallTables();
      fetchMock.mockImplementation(async () => csv(page));
      await expectIngestFailure({ stores, states: ['11'], pageDelayMs: 0 }, message);
      expect(await stores.deployment.count()).toBe(0);
      expect(await isCovered(stores.deployment, stateScope('11'))).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(message === 'Malformed CSV' ? 4 : 1);
    },
    30_000,
  );

  it('keeps deployment data but withholds coverage when the area page fails', async () => {
    await completeSmallTables();
    fetchMock.mockImplementation(async () => new Response('bad', { status: 400 }));
    fetchMock.mockResolvedValueOnce(csv('sid\nd1\n'));
    await expectIngestFailure({ stores, states: ['11'], pageDelayMs: 0 }, '400');
    expect(await stores.deployment.count()).toBe(1);
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(false);
    expect((await stores.area.readState()).status).toBe('error');
  }, 30_000);

  it('withholds the full marker when the national slice fails', async () => {
    await completeSmallTables();
    for (const fips of ALL_STATE_FIPS) await markCovered(stores.deployment, stateScope(fips));
    fetchMock.mockImplementation(async () => new Response('bad', { status: 400 }));
    await expectIngestFailure({ stores, states: 'full' }, '400');
    expect(await isCovered(stores.deployment, FULL_SCOPE)).toBe(false);
    expect(await listCovered(stores.deployment)).toHaveLength(ALL_STATE_FIPS.length);
  }, 30_000);

  it('stops before HTTP for an already cancelled run', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancel fixture'));
    await expect(
      runMirrorInit({ stores, states: ['11'], signal: controller.signal }),
    ).rejects.toThrow('cancel fixture');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listCovered(stores.deployment)).toEqual([]);
  });

  it('aborts an in-flight HTTP page without advancing coverage or fetching another page', async () => {
    await completeSmallTables();
    const controller = new AbortController();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    fetchMock.mockImplementationOnce(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
          started();
        }),
    );
    const pending = runMirrorInit({ stores, states: ['11'], signal: controller.signal });
    const rejection = expect(pending).rejects.toThrow('cancel fixture');
    await requestStarted;
    controller.abort(new Error('cancel fixture'));
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await stores.deployment.count()).toBe(0);
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(false);
  });

  it('cancels during the inter-page delay while preserving the persisted resume cursor', async () => {
    await completeSmallTables();
    await Promise.all(Object.values(stores).map((store) => store.raw()));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(
      csv(`sid\n${Array.from({ length: 50_000 }, (_, i) => `d${i}`).join('\n')}\n`),
    );
    const pending = runMirrorInit({ stores, states: ['11'], signal: controller.signal });
    const rejection = expect(pending).rejects.toThrow('cancel between pages');
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    expect(await stores.deployment.count()).toBe(50_000);
    controller.abort(new Error('cancel between pages'));
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await stores.deployment.readState()).toMatchObject({
      status: 'error',
      cursor: JSON.stringify({ scope: 'state:11', offset: 50_000 }),
    });
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(false);
  });

  it('retries a failed page through the real retry and CSV paths before completing', async () => {
    await completeSmallTables();
    await Promise.all(Object.values(stores).map((store) => store.raw()));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(csv('sid\nd1\n'));
    const pending = runMirrorInit({ stores, states: ['11'], pageDelayMs: 0 });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ full: false, statesIngested: ['11'], statesSkipped: [] });
    expect(requests().map((url) => url.pathname)).toEqual([
      '/resource/jdr4-3q4p.csv',
      '/resource/jdr4-3q4p.csv',
      '/resource/xvwq-qtaj.csv',
    ]);
    expect(await stores.deployment.count()).toBe(1);
    expect(await isCovered(stores.deployment, stateScope('11'))).toBe(true);
  });

  it('waits between full pages and drains later states with fresh offsets', async () => {
    await completeSmallTables();
    await Promise.all(Object.values(stores).map((store) => store.raw()));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchMock.mockResolvedValueOnce(
      csv(`sid\n${Array.from({ length: 50_000 }, (_, i) => `d${i}`).join('\n')}\n`),
    );
    const pending = runMirrorInit({ stores, states: ['11', '53'] });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ full: false, statesIngested: ['11', '53'], statesSkipped: [] });
    expect(requests().map((url) => url.searchParams.get('$offset'))).toEqual([
      '0',
      '50000',
      '0',
      '0',
      '0',
    ]);
    expect(requests()[3]?.searchParams.get('$where')).toBe("stateabbr='WA'");
    expect(requests()[4]?.searchParams.get('$where')).toContain("id >= '53' AND id < '54'");
    expect(requests().every((url) => !url.searchParams.has('$$app_token'))).toBe(true);
    expect(await listCovered(stores.deployment)).toEqual(['state:11', 'state:53']);
  });
});
