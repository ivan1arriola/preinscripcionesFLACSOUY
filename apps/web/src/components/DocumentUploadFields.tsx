import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { TitleDocumentFields } from './TitleDocumentFields.js';
import { DocumentUploadCard } from './DocumentUploadCard.js';
import { apiClient } from '../api/client.js';
import { rememberPreview } from '../domain/file-previews.js';
import { UploadedFileChip } from './UploadedFileChip.js';
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
    <fieldset className="documents-block">
      <legend>Documentación requerida</legend>
      <p className="step-note" role="status">
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
            <div key={document.key} className="document-upload-card">
              <div>
                <h4 className="document-upload-card__title">
                  {document.label} {document.required && <span className="field-required">*</span>}
                </h4>
                <p className="document-upload-card__formats">
                  Podés adjuntar el archivo ahora o declararlo para entrega posterior por correo.
                </p>
              </div>

              <div className="choice-group" style={{ marginTop: '1rem' }}>
                <label className="choice-card">
                  <input
                    type="radio"
                    name={`choice-${document.key}`}
                    checked={!isDeferred}
                    disabled={disabled}
                    onChange={() => onChange(pendingKey, 'No')}
                  />
                  <span>Adjuntar ahora</span>
                </label>
                <label className="choice-card">
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
                  />
                  <span>Adjuntar posteriormente</span>
                </label>
              </div>

              {!isDeferred ? (
                <div className="field-group" style={{ marginTop: '1rem' }}>
                  <label htmlFor={`file-${document.key}`} className="field-label">
                    Archivo de {document.label.toLowerCase()}
                  </label>
                  <input
                    id={`file-${document.key}`}
                    type="file"
                    accept={document.acceptedMimeTypes?.join(',')}
                    disabled={disabled || uploading[document.key]}
                    onChange={async (event) => {
                      const input = event.target;
                      const file = input.files?.[0];
                      if (!file) return;
                      setUploading((current) => ({ ...current, [document.key]: true }));
                      try {
                        const token = await onUpload(document.key, file);
                        rememberPreview(token.token, file);
                        onFileToken(token);
                        setUploadErrors((current) => ({ ...current, [document.key]: undefined }));
                      } catch (uploadError) {
                        setUploadErrors((current) => ({
                          ...current,
                          [document.key]: uploadError instanceof Error ? uploadError.message : 'No se pudo cargar el archivo.',
                        }));
                      } finally {
                        setUploading((current) => ({ ...current, [document.key]: false }));
                        // Permite volver a elegir el mismo archivo después de quitarlo o de un error.
                        input.value = '';
                      }
                    }}
                    className="file-input"
                  />
                  <p className="field-hint">
                    {uploading[document.key]
                      ? 'Guardando archivo temporalmente…'
                      : uploaded.length > 0
                      ? `${uploaded.length} archivo cargado`
                      : 'Formatos admitidos: PDF, JPG, PNG o WebP (máx. 10 MiB)'}
                  </p>
                  {uploaded.length > 0 && (
                    <ul className="file-list">
                      {uploaded.map((file) => (
                        <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={handleRemoveFile} />
                      ))}
                    </ul>
                  )}
                  {uploadErrors[document.key] && (
                    <p className="field-error">{uploadErrors[document.key]}</p>
                  )}
                  {error && <p className="field-error">{error}</p>}
                </div>
              ) : (
                <div style={{ marginTop: '1rem' }}>
                  <p className="step-note" style={{ marginBottom: 0 }}>
                    Marcado para entrega posterior. El equipo de admisiones coordinará su recepción por correo.
                  </p>
                  {error && <p className="field-error">{error}</p>}
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
