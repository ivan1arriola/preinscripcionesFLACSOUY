import React, { useState } from 'react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient } from '../api/client.js';

export interface TitleDocumentFieldsProps {
  document: DocumentDefinition;
  values: Record<string, string>;
  errors: Record<string, string | undefined>;
  files: SubmissionFileToken[];
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  onUpload: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
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

  const isAbsent = values.sinTituloActual === 'Si';
  const denomination = values.tituloDenominacion ?? '';
  const uploadedFiles = files.filter((f) => f.fieldKey === document.key);
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
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = await onUpload(document.key, file);
      onFileToken(token);
      setUploadError(undefined);
    } catch (err: any) {
      setUploadError(err instanceof Error ? err.message : 'No se pudo cargar el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = async (file: SubmissionFileToken) => {
    try {
      await apiClient.removeUpload(file.token);
    } catch {}
    onRemoveToken(file);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">
          {document.label} <span className="text-red-600">*</span>
        </h4>
        <p className="text-xs text-gray-500 mt-0.5">
          Ingrese la denominación de su título y adjunte el archivo correspondiente, o declare no poseer título actualmente.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="toggle-sin-titulo"
          type="checkbox"
          checked={isAbsent}
          disabled={disabled}
          onChange={handleToggleAbsence}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="toggle-sin-titulo" className="text-sm font-medium text-gray-700">
          No poseo actualmente título
        </label>
      </div>

      {!isAbsent && (
        <div className="space-y-4 pt-2 border-t border-gray-200">
          <div>
            <label htmlFor="titulo-denominacion" className="block text-sm font-medium text-gray-700">
              Denominación del título <span className="text-red-600">*</span>
            </label>
            <input
              id="titulo-denominacion"
              type="text"
              value={denomination}
              disabled={disabled}
              placeholder="Ej. Licenciatura en Sociología"
              onChange={(e) => onChange('tituloDenominacion', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
            {denominationError && (
              <p className="text-sm text-red-600 mt-1">{denominationError}</p>
            )}
          </div>

          <div>
            <label htmlFor={`file-${document.key}`} className="block text-sm font-medium text-gray-700">
              Archivo del título <span className="text-red-600">*</span>
            </label>
            <input
              id={`file-${document.key}`}
              type="file"
              accept={document.acceptedMimeTypes?.join(',')}
              disabled={disabled || uploading}
              onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-500 mt-1">
              {uploading
                ? 'Guardando archivo temporalmente…'
                : uploadedFiles.length > 0
                ? `${uploadedFiles.length} archivo cargado`
                : 'Formatos admitidos: PDF, JPEG, PNG, WebP (máx. 10 MiB)'}
            </p>
            {uploadedFiles.map((file) => (
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
            {uploadError && <p className="text-sm text-red-600 mt-1">{uploadError}</p>}
            {fileError && <p className="text-sm text-red-600 mt-1">{fileError}</p>}
          </div>
        </div>
      )}
    </div>
  );
};
