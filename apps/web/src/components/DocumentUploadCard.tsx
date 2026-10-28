import React from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { rememberPreview } from '../domain/file-previews.js';
import { UploadedFileChip } from './UploadedFileChip.js';

export interface DocumentUploadCardProps {
  document: DocumentDefinition;
  files: SubmissionFileToken[];
  uploading: boolean;
  error?: string;
  disabled: boolean;
  onUpload: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
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

  return (
    <article className={`document-upload-card${files.length > 0 ? ' is-done' : ''}`}>
      <div className="document-upload-card__head">
        <div>
          <h4 className="document-upload-card__title">
            {document.label} {document.required && <span className="field-required" aria-label="obligatorio">*</span>}
          </h4>
          <p className="document-upload-card__formats">Formatos: {formatLabel}. Máx. 10 MiB.</p>
        </div>
        <span className={`pill ${files.length > 0 ? 'pill--done' : 'pill--pending'}`}>
          {files.length > 0 ? 'Listo' : 'Pendiente'}
        </span>
      </div>

      <label htmlFor={inputId} className="dropzone">
        {uploading ? 'Guardando archivo…' : 'Agregar archivo'}
        <span className="sr-only"> para {document.label}</span>
        <input
          id={inputId}
          type="file"
          accept={document.acceptedMimeTypes?.join(',')}
          disabled={disabled || uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              const token = await onUpload(document.key, file);
              rememberPreview(token.token, file);
              onFileToken(token);
    } catch (uploadError) {
              onError?.(uploadError instanceof Error ? uploadError.message : 'No se pudo cargar el archivo.');
            } finally {
              event.target.value = '';
            }
          }}
          className="sr-only"
        />
      </label>

      {files.length > 0 ? (
        <ul className="file-list">
          {files.map((file) => (
            <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={onRemove} removeLabel={`Quitar ${file.originalName}`} />
          ))}
        </ul>
      ) : (
        <p className="document-upload-card__empty">Pendiente de carga</p>
      )}
      {uploading && <p className="document-upload-card__status" role="status">Guardando archivo temporalmente…</p>}
      {error && <p className="document-upload-card__error" role="alert">{error}</p>}
    </article>
  );
};
