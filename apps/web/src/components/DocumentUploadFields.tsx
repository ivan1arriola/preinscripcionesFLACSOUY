import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';

interface DocumentUploadFieldsProps {
  documents: DocumentDefinition[];
  files: SubmissionFileToken[];
  disabled: boolean;
  errors: Record<string, string | undefined>;
  onUpload: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemoveToken: (file: SubmissionFileToken) => void;
}

export const DocumentUploadFields: React.FC<DocumentUploadFieldsProps> = ({ documents, files, disabled, errors, onUpload, onFileToken, onRemoveToken }) => {
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | undefined>>({});
  if (documents.length === 0) return null;
  return <fieldset className="space-y-4 border-t pt-5">
    <legend className="text-lg font-semibold text-gray-900">Documentación</legend>
    {documents.map((document) => {
      const uploaded = files.filter((file) => file.fieldKey === document.key);
      const error = errors[document.key];
      return <div key={document.key} className="field-group">
        <label htmlFor={`file-${document.key}`} className="block text-sm font-medium text-gray-700">
          {document.label} {document.required && <span className="text-red-600">*</span>}
        </label>
        <input id={`file-${document.key}`} type="file" accept={document.acceptedMimeTypes?.join(',')} disabled={disabled || uploading[document.key]} onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setUploading((current) => ({ ...current, [document.key]: true }));
          try {
            onFileToken(await onUpload(document.key, file));
            setUploadErrors((current) => ({ ...current, [document.key]: undefined }));
          } catch (uploadError) {
            setUploadErrors((current) => ({ ...current, [document.key]: uploadError instanceof Error ? uploadError.message : 'No se pudo cargar el archivo.' }));
          } finally { setUploading((current) => ({ ...current, [document.key]: false })); }
        }} />
        <p className="text-xs text-gray-500">{uploading[document.key] ? 'Guardando archivo temporalmente…' : uploaded.length > 0 ? `${uploaded.length} archivo(s) cargado(s)` : 'El archivo se guarda de forma temporal al seleccionarlo.'}</p>
        {uploaded.map((file) => <div key={file.token} className="flex items-center justify-between gap-2 text-sm text-gray-700"><span>{file.originalName}</span><button type="button" className="text-red-600 hover:underline" disabled={disabled} onClick={() => onRemoveToken(file)}>Quitar</button></div>)}
        {uploadErrors[document.key] && <p className="text-sm text-red-600">{uploadErrors[document.key]}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>;
    })}
  </fieldset>;
};
