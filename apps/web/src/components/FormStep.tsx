import React from 'react';
import type { FormStepDefinition, InputDefinition, DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { UniversalFields } from './UniversalFields.js';
import { OrientationMentionFields } from './OrientationMentionFields.js';
import { DocumentUploadFields } from './DocumentUploadFields.js';

export interface FormStepProps {
  step: FormStepDefinition;
  inputs: InputDefinition[];
  documents: DocumentDefinition[];
  values: Record<string, string>;
  allInputs?: InputDefinition[];
  allDocuments?: DocumentDefinition[];
  errors: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  files: SubmissionFileToken[];
  onUpload: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemoveToken: (file: SubmissionFileToken) => void;
  orientations?: string[];
  mentions?: string[];
}

export const FormStep: React.FC<FormStepProps> = ({
  step,
  inputs,
  documents,
  values,
  allInputs = [],
  allDocuments = [],
  errors,
  disabled,
  onChange,
  files,
  onUpload,
  onFileToken,
  onRemoveToken,
  orientations = [],
  mentions = [],
}) => {
  // If this is the confirmation step, render a summary of entered data
  if (step.id === 'confirmacion') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{step.title}</h2>
          {step.description && <p className="text-sm text-gray-600 mt-1">{step.description}</p>}
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h3 className="text-md font-semibold text-gray-800 mb-3">Resumen de tus datos</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {allInputs
              .filter((input) => input.key !== 'orientacion' && input.key !== 'mencion')
              .map((input) => {
                const val = values[input.key];
                if (!val) return null;
                return (
                  <div key={input.key} className="py-1">
                    <dt className="text-xs text-gray-500 font-medium">{input.label}</dt>
                    <dd className="text-gray-900 font-medium">{val}</dd>
                  </div>
                );
              })}
            {values.orientacion && (
              <div className="py-1">
                <dt className="text-xs text-gray-500 font-medium">Orientación</dt>
                <dd className="text-gray-900 font-medium">{values.orientacion}</dd>
              </div>
            )}
            {values.mencion && (
              <div className="py-1">
                <dt className="text-xs text-gray-500 font-medium">Mención</dt>
                <dd className="text-gray-900 font-medium">{values.mencion}</dd>
              </div>
            )}
          </dl>
        </div>

        {allDocuments.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h3 className="text-md font-semibold text-gray-800 mb-3">Documentos adjuntos</h3>
            <ul className="text-sm space-y-1">
              {allDocuments.map((doc) => {
                const uploaded = files.filter((f) => f.fieldKey === doc.key);
                return (
                  <li key={doc.key} className="flex justify-between py-1 border-b border-gray-200 last:border-b-0">
                    <span className="text-gray-600">{doc.label}:</span>
                    <span className="font-medium text-gray-900">
                      {uploaded.length > 0
                        ? uploaded.map((u) => u.originalName).join(', ')
                        : doc.required
                        ? 'Pendiente'
                        : 'No adjuntado'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Filter out orientacion and mencion from standard UniversalFields if they are rendered separately
  const regularInputs = inputs.filter(
    (input) => input.key !== 'orientacion' && input.key !== 'mencion'
  );

  const hasOrientationInput = inputs.some((i) => i.key === 'orientacion');
  const hasMentionInput = inputs.some((i) => i.key === 'mencion');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{step.title}</h2>
        {step.description && <p className="text-sm text-gray-600 mt-1">{step.description}</p>}
      </div>

      {regularInputs.length > 0 && (
        <UniversalFields
          inputs={regularInputs}
          values={values}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      {(hasOrientationInput || hasMentionInput || orientations.length > 0 || mentions.length > 0) &&
        (orientations.length > 0 || mentions.length > 0) && (
          <OrientationMentionFields
            orientations={orientations}
            mentions={mentions}
            selectedOrientation={values.orientacion || ''}
            selectedMention={values.mencion || ''}
            onOrientationChange={(val) => onChange('orientacion', val)}
            onMentionChange={(val) => onChange('mencion', val)}
            orientationRequired={hasOrientationInput}
            mentionRequired={hasMentionInput}
            orientationError={errors.orientacion}
            mentionError={errors.mencion}
            disabled={disabled}
          />
        )}

      {documents.length > 0 && (
        <DocumentUploadFields
          documents={documents}
          files={files}
          disabled={disabled}
          errors={errors}
          onUpload={onUpload}
          onFileToken={onFileToken}
          onRemoveToken={onRemoveToken}
        />
      )}
    </div>
  );
};
