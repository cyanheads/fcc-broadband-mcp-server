/**
 * @fileoverview Tests for the OpenDataService shutdown path wired into
 * `createApp({ teardown })`.
 *
 * The Form 477 mirror is the one service resource that outlives a request — a
 * SQLite file handle per store, opened lazily on the first mirrored read and
 * held until something closes it. Nothing in a request path releases them, so
 * the teardown hook is the only call, and a break here is invisible until a
 * redeployed container finds its database file still locked.
 * @module tests/services/open-data/open-data-service-shutdown.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import type { Form477Mirror } from '@/services/open-data/mirror/form477-mirror.js';
import { OpenDataService } from '@/services/open-data/open-data-service.js';

const MIRROR_OFF: ServerConfig = { mirrorEnabled: false, mirrorPath: 'data/fcc-mirror' };
const MIRROR_ON: ServerConfig = { mirrorEnabled: true, mirrorPath: 'data/fcc-mirror' };

function makeService(mirror?: Form477Mirror): OpenDataService {
  return new OpenDataService({} as AppConfig, {} as StorageService, MIRROR_OFF, mirror);
}

/**
 * Load a fresh copy of the service module and the mirror class it constructs,
 * so the spy lands on the same class instance the module will instantiate.
 * The init/accessor pair holds module-level state, which each case needs clean.
 */
async function freshModules(): Promise<{
  closeOpenDataService: () => Promise<void>;
  initOpenDataService: (
    config: AppConfig,
    storage: StorageService,
    serverConfig: ServerConfig,
  ) => void;
  mirrorClose: ReturnType<typeof vi.spyOn>;
}> {
  vi.resetModules();
  const mirrorModule = await import('@/services/open-data/mirror/form477-mirror.js');
  const mirrorClose = vi
    .spyOn(mirrorModule.Form477Mirror.prototype, 'close')
    .mockResolvedValue(undefined);
  const { closeOpenDataService, initOpenDataService } = await import(
    '@/services/open-data/open-data-service.js'
  );
  return { closeOpenDataService, initOpenDataService, mirrorClose };
}

describe('OpenDataService shutdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('close()', () => {
    it('closes the mirror it was constructed with', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      await makeService({ close } as unknown as Form477Mirror).close();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('resolves when no mirror is configured', async () => {
      await expect(makeService().close()).resolves.toBeUndefined();
    });

    it('propagates a mirror close failure rather than swallowing it', async () => {
      // The framework logs a teardown error and exits anyway; hiding it here
      // would cost the log line that says which handle never released.
      const close = vi.fn().mockRejectedValue(new Error('database is locked'));
      await expect(makeService({ close } as unknown as Form477Mirror).close()).rejects.toThrow(
        'database is locked',
      );
    });
  });

  describe('closeOpenDataService()', () => {
    it('releases the mirror the init hook constructed', async () => {
      const { closeOpenDataService, initOpenDataService, mirrorClose } = await freshModules();
      initOpenDataService({} as AppConfig, {} as StorageService, MIRROR_ON);

      await closeOpenDataService();

      expect(mirrorClose).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the mirror is disabled', async () => {
      const { closeOpenDataService, initOpenDataService, mirrorClose } = await freshModules();
      initOpenDataService({} as AppConfig, {} as StorageService, MIRROR_OFF);

      await closeOpenDataService();

      expect(mirrorClose).not.toHaveBeenCalled();
    });

    it('resolves when setup never ran', async () => {
      // Shutdown runs on paths where `setup()` never completed — a startup that
      // failed before it, or a signal during initialization.
      const { closeOpenDataService, mirrorClose } = await freshModules();

      await expect(closeOpenDataService()).resolves.toBeUndefined();

      expect(mirrorClose).not.toHaveBeenCalled();
    });

    it('is idempotent across repeated shutdowns', async () => {
      const { closeOpenDataService, initOpenDataService, mirrorClose } = await freshModules();
      initOpenDataService({} as AppConfig, {} as StorageService, MIRROR_ON);

      await closeOpenDataService();
      await closeOpenDataService();

      // The store's own `close()` collapses a repeat onto the in-flight close,
      // so a second teardown pass is safe rather than a double free.
      expect(mirrorClose).toHaveBeenCalledTimes(2);
    });
  });
});
