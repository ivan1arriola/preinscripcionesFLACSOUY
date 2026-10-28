import React from 'react';
import type { AgreementOption, FormStepDefinition, InputDefinition, DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
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
  onBlurField?: (key: string) => void;
  files: SubmissionFileToken[];
  onUpload: (fieldKey: string, file: File, onProgress?: (percent: number) => void) => Promise<SubmissionFileToken>;
  onFileToken: (file: SubmissionFileToken) => void;
  onRemoveToken: (file: SubmissionFileToken) => void;
  orientations?: string[];
  mentions?: string[];
  agreements?: AgreementOption[];
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
  onBlurField,
  files,
  onUpload,
  onFileToken,
  onRemoveToken,
  orientations = [],
  mentions = [],
  agreements = [],
}) => {
  // If this is the confirmation step, render a summary of entered data
  if (step.id === 'confirmacion') {
    return (
      <div className="space-y-6">
        <div className="step-heading">
          <h2>{step.title}</h2>
          {step.description && <p>{step.description}</p>}
        </div>

        <div className="summary-section-card">
          <h3 className="summary-section-card__head">Resumen de tus datos</h3>
          <dl className="summary-fields">
            {allInputs
              .filter((input) => input.key !== 'orientacion' && input.key !== 'mencion')
              .map((input) => {
                const val = values[input.key];
                if (!val) return null;
                return (
                  <div key={input.key} className="summary-field">
                    <dt>{input.label}</dt>
                    <dd>{val}</dd>
                  </div>
                );
              })}
            {values.orientacion && (
              <div className="summary-field">
                <dt>Orientación</dt>
                <dd>{values.orientacion}</dd>
              </div>
            )}
            {values.mencion && (
              <div className="summary-field">
                <dt>Mención</dt>
                <dd>{values.mencion}</dd>
              </div>
            )}
          </dl>
        </div>

        {allDocuments.length > 0 && (
          <div className="summary-section-card">
            <h3 className="summary-section-card__head">Documentos adjuntos</h3>
            <ul className="summary-documents">
              {allDocuments.map((doc) => {
                const uploaded = files.filter((f) => f.fieldKey === doc.key);
                return (
                  <li key={doc.key} className="summary-document">
                    <span>{doc.label}:</span>
                    <span className="summary-document__name">
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

  // Filter out orientacion and mencion from standard UniversalFields if they are rendered separately,
  // and exclude title denomination/alternative inputs which are rendered inside DocumentUploadFields
  const regularInputs = inputs.filter(
    (input) =>
      input.key !== 'orientacion' &&
      input.key !== 'mencion' &&
      input.key !== 'tituloDenominacion' &&
      input.key !== 'sinTituloActual'
  );

  const hasOrientationInput = inputs.some((i) => i.key === 'orientacion');
  const hasMentionInput = inputs.some((i) => i.key === 'mencion');

  return (
    <div className="space-y-6">
      <div className="step-heading">
        <h2>{step.title}</h2>
        {step.description && <p>{step.description}</p>}
      </div>

      {regularInputs.length > 0 && (
        <UniversalFields
          inputs={regularInputs}
          values={values}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
          onBlurField={onBlurField}
          agreements={agreements}
        />
      )}

      {(hasOrientationInput || hasMentionInput) &&
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
          values={values}
          disabled={disabled}
          errors={errors}
          onChange={onChange}
          onUpload={onUpload}
          onFileToken={onFileToken}
          onRemoveToken={onRemoveToken}
        />
      )}
    </div>
  );
};
