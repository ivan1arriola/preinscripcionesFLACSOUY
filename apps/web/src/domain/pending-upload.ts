/** Archivo que se está subiendo: lo que se muestra mientras tanto (nombre, avance y miniatura local). */
export interface PendingUpload {
  name: string;
  size: number;
  mimeType: string;
  /** Miniatura local de una imagen; se libera apenas termina la carga. */
  previewUrl?: string;
  /** 0 a 100. */
  percent: number;
  remainingSeconds?: number;
  /** Momento (ms) del último avance real, para avisar si la carga se frenó. */
  updatedAt?: number;
  status?: 'uploading' | 'error';
  error?: string;
}
