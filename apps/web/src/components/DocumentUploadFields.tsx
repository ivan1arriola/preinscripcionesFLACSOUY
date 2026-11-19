import React from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { TitleDocumentFields } from './TitleDocumentFields.js';
import { DocumentUploadCard } from './DocumentUploadCard.js';
import { apiClient } from '../api/client.js';
import { UploadedFileChip } from './UploadedFileChip.js';
import { getDocumentProgress } from './preinscription-form-view-model.js';
import { fileLimitInfo } from './file-limits.js';
import { ResumableFileUploader } from './ResumableFileUploader.js';

export interface DocumentUploadFieldsProps {
  documents: DocumentDefinition[];
  files: SubmissionFileToken[];
  values: Record<string, string>;
  disabled: boolean;
  errors: Record<string, string | undefined>;
  onChange: (key: string, value: string) => void;
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number, remainingSeconds?: number) => void) => Promise<SubmissionFileToken>;
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
                  <ResumableFileUploader document={document} disabled={disabled || fileLimitInfo(document, uploaded.length).full}
                    availableSlots={fileLimitInfo(document, uploaded.length).max - uploaded.length} onUpload={onUpload}
                    onUploaded={onFileToken} className="dropzone" />
                  <p className="field-hint">
                    {fileLimitInfo(document, uploaded.length).multi
                      ? `Formatos admitidos: PDF, JPG, PNG o WebP (máx. 10 MiB cada uno). Hasta ${document.maxFiles} archivos: podés combinar PDF e imágenes.`
                      : 'Formatos admitidos: PDF, JPG, PNG o WebP (máx. 10 MiB)'}
                  </p>
                  {uploaded.length > 0 && (
                    <p className="field-hint">
                      {fileLimitInfo(document, uploaded.length).multi
                        ? `${uploaded.length} de ${document.maxFiles} archivos cargados`
                        : `${uploaded.length} archivo cargado`}
                    </p>
                  )}
                  {uploaded.length > 0 && (
                    <ul className="file-list">
                      {uploaded.map((file) => (
                        <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={handleRemoveFile} />
                      ))}
                    </ul>
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
            error={error}
            disabled={disabled}
            onUpload={onUpload}
            onFileToken={onFileToken}
            onRemove={handleRemoveFile}
          />
        );
      })}
    </fieldset>
  );
};
