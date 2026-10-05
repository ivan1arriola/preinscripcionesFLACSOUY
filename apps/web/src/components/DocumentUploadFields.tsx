import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { TitleDocumentFields } from './TitleDocumentFields.js';
import { DocumentUploadCard } from './DocumentUploadCard.js';
import { apiClient } from '../api/client.js';
import { getDocumentProgress } from './preinscription-form-view-model.js';

export interface DocumentUploadFieldsProps {
  documents: DocumentDefinition[];
  files: SubmissionFileToken[];
  values: Record<string, string>;
  disabled: boolean;
  errors: Record<string, string | undefined>;
  onChange: (key: string, value: string) => void;
  onUpload: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemoveToken: (file: SubmissionFileToken) => void;
}

export const DocumentUploadFields: React.FC<DocumentUploadFieldsProps> = ({
  documents,
  files,
  values,
  disabled,
  errors,
  onChange,
  onUpload,
  onFileToken,
  onRemoveToken,
}) => {
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | undefined>>({});

  if (documents.length === 0) return null;

  const progress = getDocumentProgress(documents, files);

  const handleRemoveFile = async (file: SubmissionFileToken) => {
    try {
      await apiClient.removeUpload(file.token);
    } catch {}
    onRemoveToken(file);
  };

  return (
    <fieldset className="space-y-6 border-t pt-5">
      <legend className="text-lg font-semibold text-gray-900">Documentación requerida</legend>
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900" role="status">
        {progress.uploaded} de {progress.required} documentos obligatorios cargados
      </p>
      {documents.map((document) => {
        // Special case: Title of degree
        if (document.key === 'titulo') {
          return (
            <TitleDocumentFields
              key={document.key}
              document={document}
              values={values}
              errors={errors}
              files={files}
              disabled={disabled}
              onChange={onChange}
              onUpload={onUpload}
              onFileToken={onFileToken}
              onRemoveToken={onRemoveToken}
            />
          );
        }

        const uploaded = files.filter((file) => file.fieldKey === document.key);
        const error = errors[document.key];

        // Deferrable recommendation letter
        if (document.alternative?.kind === 'defer') {
          const pendingKey = document.alternative.valueKey;
          const isDeferred = values[pendingKey] === 'Si';

          return (
            <div key={document.key} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-4">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {document.label} {document.required && <span className="text-red-600">*</span>}
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  Podés adjuntar el archivo ahora o declararlo para entrega posterior por correo.
                </p>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`choice-${document.key}`}
                    checked={!isDeferred}
                    disabled={disabled}
                    onChange={() => onChange(pendingKey, 'No')}
                    className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Adjuntar ahora</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`choice-${document.key}`}
                    checked={isDeferred}
                    disabled={disabled}
                    onChange={async () => {
                      onChange(pendingKey, 'Si');
                      for (const file of uploaded) {
                        try {
                          await apiClient.removeUpload(file.token);
                        } catch {}
                        onRemoveToken(file);
                      }
                    }}
                    className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Adjuntar posteriormente</span>
                </label>
              </div>

              {!isDeferred ? (
                <div className="pt-2 border-t border-gray-200">
                  <label htmlFor={`file-${document.key}`} className="block text-sm font-medium text-gray-700">
                    Archivo de {document.label.toLowerCase()}
                  </label>
                  <input
                    id={`file-${document.key}`}
                    type="file"
                    accept={document.acceptedMimeTypes?.join(',')}
                    disabled={disabled || uploading[document.key]}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setUploading((current) => ({ ...current, [document.key]: true }));
                      try {
                        const token = await onUpload(document.key, file);
                        onFileToken(token);
                        setUploadErrors((current) => ({ ...current, [document.key]: undefined }));
                      } catch (uploadError) {
                        setUploadErrors((current) => ({
                          ...current,
                          [document.key]: uploadError instanceof Error ? uploadError.message : 'No se pudo cargar el archivo.',
                        }));
                      } finally {
                        setUploading((current) => ({ ...current, [document.key]: false }));
                      }
                    }}
                    className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {uploading[document.key]
                      ? 'Guardando archivo temporalmente…'
                      : uploaded.length > 0
                      ? `${uploaded.length} archivo cargado`
                      : 'Formato admitido: PDF (máx. 10 MiB)'}
                  </p>
                  {uploaded.map((file) => (
                    <div
                      key={file.token}
                      className="flex items-center justify-between gap-2 text-sm text-gray-700 mt-2 p-2 bg-white rounded border border-gray-200"
                    >
                      <span>{file.originalName}</span>
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs"
                        disabled={disabled}
                        onClick={() => handleRemoveFile(file)}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                  {uploadErrors[document.key] && (
                    <p className="text-sm text-red-600 mt-1">{uploadErrors[document.key]}</p>
                  )}
                  {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
                </div>
              ) : (
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-sm text-gray-600 bg-blue-50 p-2.5 rounded border border-blue-200">
                    Marcado para entrega posterior. El equipo de admisiones coordinará su recepción por correo.
                  </p>
                  {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
                </div>
              )}
            </div>
          );
        }

        // Standard document (identidad, cv, cartaMotivacion)
        return (
          <DocumentUploadCard
            key={document.key}
            document={document}
            files={uploaded}
            uploading={Boolean(uploading[document.key])}
            error={uploadErrors[document.key] ?? error}
            disabled={disabled}
            onUpload={async (fieldKey, file) => {
              setUploading((current) => ({ ...current, [fieldKey]: true }));
              try {
                const token = await onUpload(fieldKey, file);
                setUploadErrors((current) => ({ ...current, [fieldKey]: undefined }));
                return token;
              } finally {
                setUploading((current) => ({ ...current, [fieldKey]: false }));
              }
            }}
            onFileToken={onFileToken}
            onRemove={handleRemoveFile}
            onError={(message) => setUploadErrors((current) => ({ ...current, [document.key]: message }))}
          />
        );
      })}
    </fieldset>
  );
};
