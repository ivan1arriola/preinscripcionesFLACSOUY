import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { UploadedFileChip } from './UploadedFileChip.js';
import { fileLimitInfo } from './file-limits.js';
import { ResumableFileUploader } from './ResumableFileUploader.js';

export interface DocumentUploadCardProps {
  document: DocumentDefinition;
  files: SubmissionFileToken[];
  uploading?: boolean;
  error?: string;
  disabled: boolean;
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number, remainingSeconds?: number) => void) => Promise<SubmissionFileToken>;
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
  const [hasPendingUploads, setHasPendingUploads] = useState(false);
  const formatLabel = document.acceptedMimeTypes?.map((mime) => (mime === 'image/jpeg' ? 'JPG' : mime.split('/')[1]?.toUpperCase())).join(', ') || 'PDF';
  const busy = uploading || hasPendingUploads;
  const state = busy ? 'uploading' : files.length > 0 ? 'done' : 'pending';
  const { max, multi, full } = fileLimitInfo(document, files.length);

  return (
    <article className={`document-upload-card${state === 'done' ? ' is-done' : ''}${busy ? ' is-uploading' : ''}`} aria-busy={busy}>
      <div className="document-upload-card__head">
        <div>
          <h4 className="document-upload-card__title">
            {document.label} {document.required && <span className="field-required" aria-label="obligatorio">*</span>}
          </h4>
          <p className="document-upload-card__formats">
            {multi
              ? `Formatos: ${formatLabel}. Hasta ${max} archivos: podés combinar PDF e imágenes. Máx. 10 MiB cada uno.`
              : `Formatos: ${formatLabel}. Máx. 10 MiB.`}
          </p>
        </div>
        <span className={`pill pill--${state}`}>
          {state === 'uploading' ? 'Subiendo' : state === 'done' ? 'Listo' : 'Pendiente'}
        </span>
      </div>

      <ResumableFileUploader document={document} disabled={disabled || full} availableSlots={max - files.length} onUpload={onUpload} onUploaded={onFileToken} onError={onError} onActiveChange={setHasPendingUploads} />

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={onRemove} removeLabel={`Quitar ${file.originalName}`} />
          ))}
        </ul>
      )}
      {multi && files.length > 0 && <p className="document-upload-card__count">{files.length} de {max} archivos</p>}
      {multi && full && <p className="document-upload-card__full">Alcanzaste el máximo de {max} archivos. Quitá uno para cambiarlo.</p>}
      {files.length === 0 && !busy && <p className="document-upload-card__empty">Pendiente de carga</p>}
      {error && <p className="document-upload-card__error" role="alert">{error}</p>}
    </article>
  );
};
