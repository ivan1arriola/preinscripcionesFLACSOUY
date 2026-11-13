import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { rememberPreview } from '../domain/file-previews.js';
import { usePendingUploads } from '../domain/pending-upload.js';
import { UploadingFileRow } from './UploadingFileRow.js';
import { UploadedFileChip } from './UploadedFileChip.js';
import { fileLimitInfo } from './file-limits.js';

export interface TitleDocumentFieldsProps {
  document: DocumentDefinition;
  values: Record<string, string>;
  errors: Record<string, string | undefined>;
  files: SubmissionFileToken[];
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number) => void) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemoveToken: (file: SubmissionFileToken) => void;
}

export const TitleDocumentFields: React.FC<TitleDocumentFieldsProps> = ({
  document,
  values,
  errors,
  files,
  disabled,
  onChange,
  onUpload,
  onFileToken,
  onRemoveToken,
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const pendingUploads = usePendingUploads();

  const isAbsent = values.sinTituloActual === 'Si';
  const denomination = values.tituloDenominacion ?? '';
  const uploadedFiles = files.filter((f) => f.fieldKey === document.key);
  const { max, multi, full } = fileLimitInfo(document, uploadedFiles.length);
  const denominationError = errors.tituloDenominacion;
  const fileError = errors[document.key];

  const handleToggleAbsence = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (checked) {
      onChange('sinTituloActual', 'Si');
      onChange('tituloDenominacion', '');
      for (const file of uploadedFiles) {
        try {
          await apiClient.removeUpload(file.token);
        } catch {
          // ignore if already removed
        }
        onRemoveToken(file);
      }
    } else {
      onChange('sinTituloActual', 'No');
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    const report = pendingUploads.begin(document.key, file);
    try {
      const token = await onUpload(document.key, file, report);
      rememberPreview(token.token, file);
      onFileToken(token);
      setUploadError(undefined);
    } catch (err: any) {
      setUploadError(err instanceof Error ? err.message : 'No se pudo cargar el archivo.');
    } finally {
      pendingUploads.finish(document.key);
      setUploading(false);
      // Sin esto el navegador no vuelve a disparar `change` si se elige de nuevo el mismo archivo.
      input.value = '';
    }
  };

  const handleRemoveFile = async (file: SubmissionFileToken) => {
    try {
      await apiClient.removeUpload(file.token);
    } catch {}
    onRemoveToken(file);
  };

  return (
    <div className="document-upload-card">
      <div>
        <h4 className="document-upload-card__title">
          {document.label} <span className="field-required">*</span>
        </h4>
        <p className="document-upload-card__formats">
          Ingrese la denominación de su título y adjunte el archivo correspondiente, o declare no poseer título actualmente.
        </p>
      </div>

      {/* Decision card for title possession */}
      <div className={`panel-soft${isAbsent ? ' is-active' : ''}`} style={{ marginTop: '1rem' }}>
        <label
          htmlFor="toggle-sin-titulo"
          className="checkbox-row"
        >
          <input
            id="toggle-sin-titulo"
            type="checkbox"
            checked={isAbsent}
            disabled={disabled}
            onChange={handleToggleAbsence}
          />
          <div>
            <strong>
              No poseo actualmente título
            </strong>
            <span>
              {isAbsent
                ? 'Ha declarado no poseer título. Se omitirá la denominación y la carga del comprobante.'
                : 'Marque esta opción únicamente si no cuenta con un título de grado o terciario finalizado.'}
            </span>
          </div>
        </label>
      </div>

      {!isAbsent && (
        <div className="fields-grid" style={{ marginTop: '1rem' }}>
          <div className={`field-group field-group--wide${denominationError ? ' has-error' : ''}`}>
            <label htmlFor="titulo-denominacion" className="field-label">
              Denominación del título <span className="field-required">*</span>
            </label>
            <input
              id="titulo-denominacion"
              type="text"
              value={denomination}
              disabled={disabled}
              placeholder="Ej. Licenciatura en Sociología"
              onChange={(e) => onChange('tituloDenominacion', e.target.value)}
              aria-invalid={denominationError ? true : undefined}
            />
            {denominationError && (
              <p className="field-error">{denominationError}</p>
            )}
          </div>

          <div className={`field-group field-group--wide${fileError ? ' has-error' : ''}`}>
            <label htmlFor={`file-${document.key}`} className="field-label">
              Archivo del título <span className="field-required">*</span>
            </label>
            <input
              id={`file-${document.key}`}
              type="file"
              accept={[...(document.acceptedMimeTypes ?? []), '.wspimage'].join(',')}
              disabled={disabled || uploading || full}
              onChange={handleFileChange}
              className="file-input"
            />
            <p className="field-hint">
              {multi
                ? `Formatos admitidos: PDF, JPG, PNG o WebP (máx. 10 MiB cada uno). Hasta ${max} archivos: podés combinar PDF e imágenes.`
                : 'Formatos admitidos: PDF, JPG, PNG o WebP (máx. 10 MiB)'}
            </p>
            {uploadedFiles.length > 0 && (
              <p className="field-hint">
                {multi ? `${uploadedFiles.length} de ${max} archivos cargados` : `${uploadedFiles.length} archivo cargado`}
              </p>
            )}
            {pendingUploads.pending[document.key] && <UploadingFileRow upload={pendingUploads.pending[document.key]} />}
            {uploadedFiles.length > 0 && (
              <ul className="file-list">
                {uploadedFiles.map((file) => (
                  <UploadedFileChip key={file.token} file={file} disabled={disabled} onRemove={handleRemoveFile} />
                ))}
              </ul>
            )}
            {uploadError && <p className="field-error">{uploadError}</p>}
            {fileError && <p className="field-error">{fileError}</p>}
          </div>
        </div>
      )}
    </div>
  );
};
