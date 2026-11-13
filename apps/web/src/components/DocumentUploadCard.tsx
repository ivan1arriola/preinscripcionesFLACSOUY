import React from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { rememberPreview } from '../domain/file-previews.js';
import { usePendingUploads } from '../domain/pending-upload.js';
import { UploadedFileChip } from './UploadedFileChip.js';
import { UploadingFileRow } from './UploadingFileRow.js';

export interface DocumentUploadCardProps {
  document: DocumentDefinition;
  files: SubmissionFileToken[];
  uploading: boolean;
  error?: string;
  disabled: boolean;
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number) => void) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemove: (file: SubmissionFileToken) => void;
  onError?: (message: string) => void;
}

export const DocumentUploadCard: React.FC<DocumentUploadCardProps> = ({
  document,
  files,
  uploading,
  error,
  disabled,
  onUpload,
  onFileToken,
  onRemove,
  onError,
}) => {
  const inputId = `file-${document.key}`;
  const formatLabel = document.acceptedMimeTypes?.map((mime) => (mime === 'image/jpeg' ? 'JPG' : mime.split('/')[1]?.toUpperCase())).join(', ') || 'PDF';
  const { pending, begin, finish } = usePendingUploads();
  const current = pending[document.key];
  const busy = uploading || Boolean(current);
  const state = busy ? 'uploading' : files.length > 0 ? 'done' : 'pending';

  return (
    <article className={`document-upload-card${state === 'done' ? ' is-done' : ''}${busy ? ' is-uploading' : ''}`} aria-busy={busy}>
      <div className="document-upload-card__head">
        <div>
          <h4 className="document-upload-card__title">
            {document.label} {document.required && <span className="field-required" aria-label="obligatorio">*</span>}
          </h4>
          <p className="document-upload-card__formats">Formatos: {formatLabel}. Máx. 10 MiB.</p>
        </div>
        <span className={`pill pill--${state}`}>
          {state === 'uploading' ? 'Subiendo' : state === 'done' ? 'Listo' : 'Pendiente'}
        </span>
      </div>

      <label htmlFor={inputId} className={`dropzone${busy ? ' is-busy' : ''}`}>
        Agregar archivo
        <span className="sr-only"> para {document.label}</span>
        <input
          id={inputId}
          type="file"
          accept={[...(document.acceptedMimeTypes ?? []), '.wspimage'].join(',')}
          disabled={disabled || busy}
          onChange={async (event) => {
            const input = event.target;
            const file = input.files?.[0];
            if (!file) return;
            const report = begin(document.key, file);
            try {
              const token = await onUpload(document.key, file, report);
              rememberPreview(token.token, file);
              onFileToken(token);
            } catch (uploadError) {
              onError?.(uploadError instanceof Error ? uploadError.message : 'No se pudo cargar el archivo.');
            } finally {
              finish(document.key);
              input.value = '';
            }
          }}
          className="sr-only"
        />
      </label>

      {(files.length > 0 || busy) && (
        <ul className="file-list">
          {files.map((file) => (
            <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={onRemove} removeLabel={`Quitar ${file.originalName}`} />
          ))}
          {busy && <li className="file-list__item"><UploadingFileRow upload={current} /></li>}
        </ul>
      )}
      {files.length === 0 && !busy && <p className="document-upload-card__empty">Pendiente de carga</p>}
      {error && <p className="document-upload-card__error" role="alert">{error}</p>}
    </article>
  );
};
