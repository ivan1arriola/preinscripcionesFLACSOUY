import React from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';

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
  const formatLabel = document.acceptedMimeTypes?.map((mime) => mime.split('/')[1]?.toUpperCase()).join(', ') || 'PDF';

  return (
    <article className="document-upload-card rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-gray-900">
            {document.label} {document.required && <span className="text-red-600" aria-label="obligatorio">*</span>}
          </h4>
          <p className="mt-1 text-xs text-gray-600">Formatos: {formatLabel}. Máx. 10 MiB.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${files.length > 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
          {files.length > 0 ? 'Listo' : 'Pendiente'}
        </span>
      </div>

      <label htmlFor={inputId} className="mt-4 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800 hover:bg-blue-100">
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
              onFileToken(await onUpload(document.key, file));
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
        <ul className="mt-3 space-y-2">
          {files.map((file) => (
            <li key={file.token} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
              <span className="min-w-0 break-words">{file.originalName}</span>
              <button type="button" aria-label={`Quitar ${file.originalName}`} className="min-h-11 shrink-0 px-2 text-sm font-semibold text-red-700 hover:underline" disabled={disabled} onClick={() => onRemove(file)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-gray-600">Pendiente de carga</p>
      )}
      {uploading && <p className="mt-2 text-sm text-blue-800" role="status">Guardando archivo temporalmente…</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </article>
  );
};
