import type { Server } from 'node:http';

/**
 * Tiempo de espera máximo para permitir que las peticiones en curso (envíos con Drive y Sheets)
 * completen antes de forzar el apagado.
 * Acotado a 110 segundos para dar margen al stop_grace_period de 120s de Docker Compose.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 110_000;

export interface GracefulShutdownLogger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface GracefulShutdownOptions {
  /** Servidor HTTP que se cerrará. */
  server: Pick<Server, 'close'>;
  /** Tiempo límite de espera en milisegundos (por defecto 110 000 ms = 110 s). */
  timeoutMs?: number;
  /** Tarea a ejecutar antes de cerrar el servidor (p. ej. detener intervalos de barrido/limpieza). */
  onBeforeClose?: () => Promise<void> | void;
  /** Tarea a ejecutar después de cerrar el servidor (p. ej. cerrar la conexión con la base de datos). */
  onAfterClose?: () => Promise<void> | void;
  /** Función para finalizar el proceso (por defecto `process.exit`). */
  exitFn?: (code: number) => void;
  /** Logger opcional para registrar eventos y advertencias. */
  logger?: GracefulShutdownLogger;
}

/**
 * Crea un manejador de apagado ordenado idempotente para señales como SIGTERM o SIGINT.
 */
export function createGracefulShutdownHandler(options: GracefulShutdownOptions): (signal: string) => Promise<void> {
  const {
    server,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    onBeforeClose,
    onAfterClose,
    exitFn = (code) => process.exit(code),
    logger = console,
  } = options;

  let shutdownPromise: Promise<void> | null = null;

  return (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      logger.log(`[Process] ${signal} recibido: cerrando el servidor de forma ordenada (máx ${Math.round(timeoutMs / 1000)} s)...`);

      let exitCode = 0;

      if (onBeforeClose) {
        try {
          await onBeforeClose();
        } catch (error) {
          logger.error('[Process] Error durante onBeforeClose:', error instanceof Error ? error.message : error);
        }
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<{ timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => {
          logger.error(`[Process] Se superó el tiempo límite de ${Math.round(timeoutMs / 1000)} s para el apagado ordenado.`);
          resolve({ timedOut: true });
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      });

      const serverClosePromise = new Promise<{ timedOut: boolean }>((resolve) => {
        server.close((err) => {
          if (err) {
            logger.error('[Process] Error al cerrar el servidor HTTP:', err.message);
          }
          resolve({ timedOut: false });
        });
      });

      try {
        const result = await Promise.race([serverClosePromise, timeoutPromise]);
        if (result.timedOut) {
          exitCode = 1;
        }
      } catch (error) {
        logger.error('[Process] Error durante la espera de cierre del servidor:', error);
        exitCode = 1;
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (onAfterClose) {
        try {
          await onAfterClose();
        } catch (error) {
          logger.error('[Process] Error durante onAfterClose:', error instanceof Error ? error.message : error);
          exitCode = 1;
        }
      }

      exitFn(exitCode);
    })();

    return shutdownPromise;
  };
}
