import React from 'react';
import { UploadedFileChip } from './UploadedFileChip.js';
import type {
  FormDefinition,
  InputDefinition,
  SubmissionFileToken,
} from '@flacso/contracts';

export interface PreinscriptionSummaryProps {
  form: FormDefinition;
  values: Record<string, string>;
  files: SubmissionFileToken[];
  onEditStep: (stepIndex: number) => void;
  onConfirm: () => void;
  disabled: boolean;
}

export interface SummaryFieldItem {
  key: string;
  label: string;
  value: string;
}

export interface SummaryDocumentItem {
  key: string;
  label: string;
  files: Array<{ name: string; sizeFormatted: string; file: SubmissionFileToken }>;
  isDeferred?: boolean;
}

export interface SummarySection {
  stepIndex: number;
  stepId: string;
  title: string;
  fields: SummaryFieldItem[];
  documents: SummaryDocumentItem[];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DISPLAY_LABELS: Record<string, Record<string, string>> = {
  tipoDocumento: {
    cedula_uruguaya: 'Cédula de identidad uruguaya',
    pasaporte: 'Pasaporte',
    documento_extranjero: 'Documento extranjero',
  },
  genero: { Varon: 'Varón', 'Varon trans': 'Varón trans' },
};

export function formatFieldValue(
  key: string,
  rawVal: string | undefined,
  agreements: Array<{ id: string | number; label: string }> = []
): string {
  if (!rawVal || !rawVal.trim()) {
    return 'No informado';
  }
  const val = rawVal.trim();
  if (key === 'convenioWordpressId') {
    const found = agreements.find((a) => String(a.id) === val);
    return found ? found.label : val;
  }
  if (val === 'Si') return 'Sí';
  if (val === 'No') return 'No';
  return DISPLAY_LABELS[key]?.[val] ?? val;
}

export function isInputVisible(input: InputDefinition, values: Record<string, string>): boolean {
  const isUruguayanCedula = values.tipoDocumento === 'cedula_uruguaya';
  if (input.key === 'generoOtra') return values.genero === 'Otra';
  if (input.key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
  if (input.key === 'posgradoCual') return values.posgradoFlacso === 'Si';
  if (input.key === 'paisEmisorDocumento') return !isUruguayanCedula;
  if (input.key === 'tituloDenominacion') return values.sinTituloActual !== 'true' && values.sinTituloActual !== 'Si';
  return true;
}

export function buildSummarySections(
  form: FormDefinition,
  values: Record<string, string>,
  files: SubmissionFileToken[]
): SummarySection[] {
  const agreements = form.agreements ?? [];

  const sections = form.steps
    .map((step, stepIndex) => {
      const stepInputs = form.inputs
        .filter((i) => {
          if (i.stepId) return i.stepId === step.id;
          if (step.id === 'personal' || form.steps.length <= 2) {
            if (
              [
                'nombre',
                'nombre1',
                'nombre2',
                'apellido',
                'apellido1',
                'apellido2',
                'fechaNacimiento',
                'tipoDocumento',
                'documento',
                'paisEmisorDocumento',
                'genero',
                'generoOtra',
                'etnia',
                'paisNacimiento',
              ].includes(i.key)
            ) {
              return true;
            }
          }
          if (step.id === 'contacto') {
            return [
              'paisResidencia',
              'ciudadResidencia',
              'domicilio',
              'celular',
              'telefono',
              'email',
              'emailConfirmacion',
              'ocupacion',
            ].includes(i.key);
          }
          if (step.id === 'academico') {
            return [
              'estudios',
              'posgradoFlacso',
              'posgradoCual',
              'tituloDenominacion',
              'sinTituloActual',
            ].includes(i.key);
          }
          if (step.id === 'declaracion') {
            return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion', 'aceptaComunicaciones'].includes(i.key);
          }
          return stepIndex === 0;
        })
        .filter((i) => i.key !== 'orientacion' && isInputVisible(i, values));

      const fields: SummaryFieldItem[] = stepInputs.map((input) => {
        const isUruguayanCedula = values.tipoDocumento === 'cedula_uruguaya';
        const label = input.key === 'documento' && isUruguayanCedula ? 'Cédula de identidad uruguaya' : input.label;
        return {
          key: input.key,
          label,
          value: formatFieldValue(input.key, values[input.key], agreements),
        };
      });

      const stepDocs = (form.documents ?? []).filter((d) => {
        if (d.stepId) return d.stepId === step.id;
        return step.id === 'documentos';
      });

      const documents: SummaryDocumentItem[] = [];
      for (const doc of stepDocs) {
        if (doc.key === 'titulo' && (values.sinTituloActual === 'true' || values.sinTituloActual === 'Si')) {
          continue;
        }
        const isDeferred = doc.alternative?.kind === 'defer' && values[doc.alternative.valueKey] === 'Si';
        const docFiles = files
          .filter((f) => f.fieldKey === doc.key)
          .map((f) => ({
            name: f.originalName,
            sizeFormatted: formatFileSize(f.size),
            file: f,
          }));

        documents.push({
          key: doc.key,
          label: doc.label,
          files: docFiles,
          isDeferred,
        });
      }

      return {
        stepIndex,
        stepId: step.id,
        title: step.title,
        fields,
        documents,
      };
    })
    .filter((s) => s.fields.length > 0 || s.documents.length > 0);

  const optionValues = ['mencion']
    .filter((key) => values[key])
    .map((key) => ({
      key,
      label: 'Mención',
      value: formatFieldValue(key, values[key]),
    }));
  if (optionValues.length > 0) {
    const optionStepIndex = form.steps.findIndex((step) => step.id === 'orientacion');
    sections.push({
      stepIndex: optionStepIndex >= 0 ? optionStepIndex : 0,
      stepId: 'preinscription-options',
      title: 'Sobre esta preinscripción',
      fields: optionValues,
      documents: [],
    });
  }

  return sections;
}

export const PreinscriptionSummary: React.FC<PreinscriptionSummaryProps> = ({
  form,
  values,
  files,
  onEditStep,
  onConfirm,
  disabled,
}) => {
  const sections = buildSummarySections(form, values, files);

  return (
    <div className="preinscription-summary">
      <div className="summary-header">
        <h2>Revisión de datos antes de enviar</h2>
        <p>
          Por favor verificá que todos los datos y documentos ingresados sean correctos. Podés volver a modificar cualquier sección antes de confirmar.
        </p>
      </div>

      <div className="summary-sections">
        {sections.map((section) => (
          <section
            key={section.stepId}
            className="summary-section-card"
          >
            <div className="summary-section-card__head">
              <h3>{section.title}</h3>
              <button
                type="button"
                onClick={() => onEditStep(section.stepIndex)}
                disabled={disabled}
                className="btn btn-text"
              >
                Modificar
              </button>
            </div>

            {section.fields.length > 0 && (
              <dl className="summary-fields">
                {section.fields.map((f) => (
                  <div key={f.key} className="summary-field">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {section.documents.length > 0 && (
              <div className="summary-documents">
                <h4>Documentación</h4>
                <ul>
                  {section.documents.map((d) => (
                    <li key={d.key} className="summary-document">
                      <span className="summary-document__name">{d.label}:</span>
                      {d.isDeferred ? (
                        <span className="chip chip--warn">
                          Se entregará posteriormente
                        </span>
                      ) : d.files.length > 0 ? (
                        <ul className="file-list file-list--summary">
                          {d.files.map((item) => (
                            <UploadedFileChip key={item.file.token} file={item.file} disabled readOnly />
                          ))}
                        </ul>
                      ) : (
                        <span className="summary-missing">No informado</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="summary-actions">
        <button
          type="button"
          onClick={() => onEditStep(0)}
          disabled={disabled}
          className="btn btn-secondary"
        >
          Volver a modificar datos
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="wizard-submit-action btn btn-accent btn-large"
        >
          Confirmar y enviar preinscripción
        </button>
      </div>
    </div>
  );
};
