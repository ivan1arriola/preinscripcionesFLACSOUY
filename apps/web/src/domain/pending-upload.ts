import { useEffect, useRef, useState } from 'react';

/** Archivo que se está subiendo: lo que se muestra mientras tanto (nombre, avance y miniatura local). */
export interface PendingUpload {
  name: string;
  size: number;
  mimeType: string;
  /** Miniatura local de una imagen; se libera apenas termina la carga. */
  previewUrl?: string;
  /** 0 a 100. */
  percent: number;
}

export type ProgressCallback = (percent: number) => void;

const canCreateUrls = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

/** Estado de las cargas en curso, por campo. Cada carga devuelve su función de avance. */
export function usePendingUploads() {
  const [pending, setPending] = useState<Record<string, PendingUpload | undefined>>({});
  const urls = useRef<Record<string, string | undefined>>({});

  const release = (key: string) => {
    const url = urls.current[key];
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    urls.current[key] = undefined;
  };

  const begin = (key: string, file: File): ProgressCallback => {
    release(key);
    const previewUrl = file.type.startsWith('image/') && canCreateUrls() ? URL.createObjectURL(file) : undefined;
    urls.current[key] = previewUrl;
    setPending((current) => ({ ...current, [key]: { name: file.name, size: file.size, mimeType: file.type, previewUrl, percent: 0 } }));
    return (percent) =>
      setPending((current) => {
        const item = current[key];
        return item ? { ...current, [key]: { ...item, percent: Math.max(0, Math.min(100, Math.round(percent))) } } : current;
      });
  };

  const finish = (key: string) => {
    release(key);
    setPending((current) => ({ ...current, [key]: undefined }));
  };

  useEffect(
    () => () => {
      for (const key of Object.keys(urls.current)) release(key);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { pending, begin, finish };
}
