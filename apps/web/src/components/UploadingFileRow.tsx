import React from 'react';
import { previewKind } from '../domain/file-previews.js';
import type { PendingUpload } from '../domain/pending-upload.js';
import { formatSize } from './UploadedFileChip.js';

/** Fila que reemplaza al archivo mientras se sube: miniatura, nombre y barra de avance. */
export const UploadingFileRow: React.FC<{ upload?: PendingUpload }> = ({ upload }) => {
  const percent = upload?.percent ?? 0;
  const size = upload ? formatSize(upload.size) : '';
  const kind = upload ? previewKind(upload.mimeType, upload.name) : 'other';
  const extension = upload?.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'ARCHIVO';

  return (
    <div className="uploading-row" role="status" aria-live="polite">
      <div className="file-chip__thumb file-chip__thumb--static" aria-hidden="true">
        {upload?.previewUrl && kind === 'image' ? (
          <img src={upload.previewUrl} alt="" className="file-chip__img" />
        ) : (
          <span className="file-chip__icon">{extension}</span>
        )}
      </div>
      <div className="file-chip__meta">
        {upload && <span className="file-chip__name">{upload.name}</span>}
        <div
          className={`progress${percent >= 100 || !upload ? ' progress--busy' : ''}`}
          role="progressbar"
          aria-label="Progreso de la carga"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={upload ? percent : undefined}
        >
          <div className="progress__bar" style={{ width: upload ? `${percent}%` : '100%' }} />
        </div>
        <span className="file-chip__size">
          Guardando archivo…{upload ? ` ${percent} %` : ''}{size ? ` · ${size}` : ''}
        </span>
      </div>
    </div>
  );
};
