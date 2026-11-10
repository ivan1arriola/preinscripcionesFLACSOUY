import { useEffect, useRef } from 'react';

/** Cada cuánto se avisa al servidor que el formulario sigue abierto (los archivos vencen a los 30 min sin actividad). */
export const KEEP_ALIVE_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Mientras haya archivos subidos, renueva su vencimiento periódicamente y al volver a la pestaña.
 * Un fallo de red se ignora: se reintenta en el próximo ciclo, y el envío avisa si algo venció.
 */
export function useUploadKeepAlive(
  active: boolean,
  renew: () => Promise<unknown>,
  intervalMs: number = KEEP_ALIVE_INTERVAL_MS,
): void {
  const renewRef = useRef(renew);
  renewRef.current = renew;

  useEffect(() => {
    if (!active) return undefined;
    const run = () => {
      try {
        Promise.resolve(renewRef.current()).catch(() => undefined);
      } catch {
        // Un fallo síncrono tampoco debe romper el formulario.
      }
    };
    const timer = setInterval(run, intervalMs);
    // Una pestaña en segundo plano puede frenar los temporizadores: al volver se renueva enseguida.
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);
}
