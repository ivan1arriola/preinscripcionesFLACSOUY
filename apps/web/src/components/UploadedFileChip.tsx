import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SubmissionFileToken } from '@flacso/contracts';
import { forgetPreview, getPreview, previewKind, type FilePreviewEntry } from '../domain/file-previews.js';

// Se dibuja la primera página a este ancho; el marco A4 la recorta si la página tiene otra proporción.
const THUMB_RENDER_WIDTH = 168;

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Primera página del PDF como miniatura. Si el navegador no puede, queda el ícono «PDF». */
const PdfThumb: React.FC<{ url: string }> = ({ url }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) throw new Error('sin canvas');
        // pdf.js se descarga recién cuando se sube un PDF: no pesa en el resto del formulario.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const task = pdfjs.getDocument({ url });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_RENDER_WIDTH / base.width });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  if (failed) return <span className="file-chip__icon" aria-hidden="true">PDF</span>;
  return <canvas ref={canvasRef} className="file-chip__canvas" aria-hidden="true" />;
};

const Thumbnail: React.FC<{ preview?: FilePreviewEntry; file: SubmissionFileToken }> = ({ preview, file }) => {
  const kind = previewKind(preview?.mimeType || file.mimeType, file.originalName);
  if (preview && kind === 'image') return <img src={preview.url} alt="" className="file-chip__img" />;
  if (preview && kind === 'pdf') return <PdfThumb url={preview.url} />;
  const extension = file.originalName.split('.').pop()?.slice(0, 4).toUpperCase();
  return <span className="file-chip__icon" aria-hidden="true">{extension || 'ARCHIVO'}</span>;
};

const PreviewDialog: React.FC<{ preview: FilePreviewEntry; name: string; onClose: () => void }> = ({ preview, name, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const kind = previewKind(preview.mimeType, name);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="preview-backdrop" onClick={onClose}>
      <div className="preview-dialog" role="dialog" aria-modal="true" aria-label={`Vista previa de ${name}`} onClick={(event) => event.stopPropagation()}>
        <div className="preview-dialog__bar">
          <strong>{name}</strong>
          <div className="preview-dialog__actions">
            <a href={preview.url} target="_blank" rel="noreferrer" className="btn btn-text">Abrir en otra pestaña</a>
            <button type="button" ref={closeRef} className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <div className="preview-dialog__body">
          {kind === 'image' ? (
            <img src={preview.url} alt={name} />
          ) : (
            <iframe src={preview.url} title={`Vista previa de ${name}`} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export interface UploadedFileChipProps {
  file: SubmissionFileToken;
  disabled: boolean;
  onRemove?: (file: SubmissionFileToken) => void;
  /** Solo para mirar (pantalla de revisión): sin botón para quitar. */
  readOnly?: boolean;
  /** Texto accesible del botón «Quitar» (por ejemplo, con el nombre del archivo). */
  removeLabel?: string;
}

export const UploadedFileChip: React.FC<UploadedFileChipProps> = ({ file, disabled, onRemove, readOnly = false, removeLabel }) => {
  const preview = getPreview(file.token);
  const [open, setOpen] = useState(false);
  const size = formatSize(file.size);

  return (
    <li className={`file-chip file-chip--preview${readOnly ? ' file-chip--readonly' : ''}`}>
      <button
        type="button"
        className="file-chip__thumb"
        onClick={() => setOpen(true)}
        disabled={!preview}
        aria-hidden="true"
        tabIndex={-1}
      >
        <Thumbnail preview={preview} file={file} />
      </button>
      <div className="file-chip__meta">
        <span className="file-chip__name">{file.originalName}</span>
        {size && <span className="file-chip__size">{size}</span>}
      </div>
      <div className="file-chip__actions">
        {preview && (
          <button type="button" className="file-chip__view" aria-label={`Ver ${file.originalName}`} onClick={() => setOpen(true)}>
            Ver
          </button>
        )}
        {!readOnly && (
          <button type="button" className="file-chip__remove" aria-label={removeLabel} disabled={disabled} onClick={() => { forgetPreview(file.token); onRemove?.(file); }}>
            Quitar
          </button>
        )}
      </div>
      {open && preview && <PreviewDialog preview={preview} name={file.originalName} onClose={() => setOpen(false)} />}
    </li>
  );
};
