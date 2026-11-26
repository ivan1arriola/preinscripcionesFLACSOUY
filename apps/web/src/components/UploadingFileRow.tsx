import React, { useEffect, useState } from 'react';
import { previewKind } from '../domain/file-previews.js';
import type { PendingUpload } from '../domain/pending-upload.js';
import { isStalled } from '../domain/upload-progress.js';
import { formatSize } from './UploadedFileChip.js';

const TYPE_LABELS: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };

const typeLabel = (mimeType: string, name: string) =>
  TYPE_LABELS[mimeType] ?? (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'Archivo');

/** Fila que reemplaza al archivo mientras se sube: miniatura, nombre y barra de avance. */
export const UploadingFileRow: React.FC<{ upload?: PendingUpload; onRetry?: () => void; onDismiss?: () => void }> = ({ upload, onRetry, onDismiss }) => {
  const percent = upload?.percent ?? 0;
  const size = upload ? formatSize(upload.size) : '';
  const kind = upload ? previewKind(upload.mimeType, upload.name) : 'other';
  const type = upload ? typeLabel(upload.mimeType, upload.name) : '';
  const uploading = Boolean(upload) && upload?.status !== 'error' && percent < 100;
  const [now, setNow] = useState(() => Date.now());

  // El reloj corre solo mientras este archivo sube, para detectar que se frenó.
  useEffect(() => {
    if (!uploading) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [uploading]);

  const eta = !uploading || !upload ? '' : isStalled(upload.updatedAt, now) ? 'Sin avance…'
    : upload.remainingSeconds === undefined ? 'calculando…' : `${Math.ceil(upload.remainingSeconds)} s restantes`;

  return (
    <div className="uploading-row">
      <div className="file-chip__thumb file-chip__thumb--static" aria-hidden="true">
        {upload?.previewUrl && kind === 'image' ? (
          <img src={upload.previewUrl} alt="" className="file-chip__img" />
        ) : (
          <span className="file-chip__icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13h6M9 17h6" />
            </svg>
          </span>
        )}
      </div>
      <div className="file-chip__meta">
        {upload && <span className="file-chip__name">{upload.name}</span>}
        <div
          className={`progress${percent >= 100 || !upload ? ' progress--busy' : ''}`}
          role="progressbar"
          aria-label={upload ? `Progreso de ${upload.name}` : 'Progreso de la carga'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={upload ? percent : undefined}
          aria-valuetext={upload ? `${percent} %${eta ? `, ${eta}` : ''}` : undefined}
        >
          <div className="progress__bar" style={{ width: upload ? `${percent}%` : '100%' }} />
        </div>
        <span className="file-chip__size">
          {onRetry ? `Carga interrumpida en ${percent} %` : `Guardando archivo… ${percent} %`}{size ? ` · ${type} · ${size}` : ''}
          {eta ? ` · ${eta}` : ''}
        </span>
        {upload?.error && <span className="field-error" role="alert">{upload.error}</span>}
        {(onRetry || onDismiss) && <div className="uploading-row__actions">
          {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Reanudar carga</button>}
          {onDismiss && <button type="button" className="btn btn-secondary" onClick={onDismiss}>Quitar</button>}
        </div>}
      </div>
    </div>
  );
};
