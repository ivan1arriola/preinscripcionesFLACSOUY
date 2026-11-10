import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUploadKeepAlive } from './useUploadKeepAlive.js';

describe('useUploadKeepAlive', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renueva los archivos cada intervalo mientras haya archivos subidos', () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useUploadKeepAlive(true, renew, 1000));
    expect(renew).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(renew).toHaveBeenCalledTimes(3);
  });

  it('no renueva nada si todavía no hay archivos subidos', () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useUploadKeepAlive(false, renew, 1000));
    vi.advanceTimersByTime(5000);
    expect(renew).not.toHaveBeenCalled();
  });

  it('deja de renovar al cerrar el formulario', () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useUploadKeepAlive(true, renew, 1000));
    vi.advanceTimersByTime(1000);
    unmount();
    vi.advanceTimersByTime(5000);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('un fallo de red al renovar no rompe el formulario y se reintenta en el próximo ciclo', async () => {
    const renew = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(undefined);
    renderHook(() => useUploadKeepAlive(true, renew, 1000));
    await vi.advanceTimersByTimeAsync(2000);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it('también renueva al volver a la pestaña tras un rato en segundo plano', () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useUploadKeepAlive(true, renew, 60_000));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
