import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createGracefulShutdownHandler, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './graceful-shutdown.js';

describe('gracefulShutdown', () => {
  it('tiene un timeout predeterminado de 110 segundos', () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(110_000);
  });

  it('cierra ordenadamente el servidor y sale con código 0 cuando las peticiones terminan a tiempo', async () => {
    let closed = false;
    const fakeServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        closed = true;
        cb?.();
        return fakeServer as unknown as Server;
      }),
    };
    const onBeforeClose = vi.fn().mockResolvedValue(undefined);
    const onAfterClose = vi.fn().mockResolvedValue(undefined);
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    const shutdown = createGracefulShutdownHandler({
      server: fakeServer as unknown as Server,
      timeoutMs: 1000,
      onBeforeClose,
      onAfterClose,
      exitFn,
      logger,
    });

    await shutdown('SIGTERM');

    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
    expect(onAfterClose).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledWith(0);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('SIGTERM'));
  });

  it('fuerza salida con código 1 si el servidor supera el tiempo límite de apagado', async () => {
    vi.useFakeTimers();
    try {
      const fakeServer = {
        // Simula peticiones colgadas que nunca llaman el callback de close
        close: vi.fn(() => fakeServer as unknown as Server),
      };
      const onAfterClose = vi.fn().mockResolvedValue(undefined);
      const exitFn = vi.fn();
      const logger = { log: vi.fn(), error: vi.fn() };

      const shutdown = createGracefulShutdownHandler({
        server: fakeServer as unknown as Server,
        timeoutMs: 500,
        onAfterClose,
        exitFn,
        logger,
      });

      const shutdownPromise = shutdown('SIGTERM');

      // Avanzamos el reloj simulado más allá del timeout
      await vi.advanceTimersByTimeAsync(600);
      await shutdownPromise;

      expect(exitFn).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('tiempo límite'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('es idempotente y no ejecuta dos veces el cierre ante múltiples señales', async () => {
    let closeCalls = 0;
    const fakeServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        closeCalls++;
        queueMicrotask(() => cb?.());
        return fakeServer as unknown as Server;
      }),
    };
    const onBeforeClose = vi.fn().mockResolvedValue(undefined);
    const onAfterClose = vi.fn().mockResolvedValue(undefined);
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    const shutdown = createGracefulShutdownHandler({
      server: fakeServer as unknown as Server,
      timeoutMs: 1000,
      onBeforeClose,
      onAfterClose,
      exitFn,
      logger,
    });

    const p1 = shutdown('SIGTERM');
    const p2 = shutdown('SIGINT');

    await Promise.all([p1, p2]);

    expect(closeCalls).toBe(1);
    expect(onBeforeClose).toHaveBeenCalledTimes(1);
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('captura errores en onAfterClose y sale con código 1', async () => {
    const fakeServer = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.();
        return fakeServer as unknown as Server;
      }),
    };
    const onAfterClose = vi.fn().mockRejectedValue(new Error('Fallo al cerrar base de datos'));
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    const shutdown = createGracefulShutdownHandler({
      server: fakeServer as unknown as Server,
      timeoutMs: 1000,
      onAfterClose,
      exitFn,
      logger,
    });

    await shutdown('SIGTERM');

    expect(exitFn).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('onAfterClose'),
      expect.stringContaining('Fallo al cerrar base de datos')
    );
  });
});
