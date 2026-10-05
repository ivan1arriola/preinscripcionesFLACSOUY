import React from 'react';
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
  files: Array<{ name: string; sizeFormatted: string }>;
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
  return val;
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
            return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion'].includes(i.key);
          }
          return stepIndex === 0;
        })
        .filter((i) => isInputVisible(i, values));

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

  const optionValues = ['orientacion', 'mencion']
    .filter((key) => values[key])
    .map((key) => ({
      key,
      label: key === 'orientacion' ? 'Orientación' : 'Mención',
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
    <div className="preinscription-summary space-y-6">
      <div className="summary-header">
        <h2 className="text-xl font-bold text-gray-900">Revisión de datos antes de enviar</h2>
        <p className="text-sm text-gray-600 mt-1">
          Por favor verificá que todos los datos y documentos ingresados sean correctos. Podés volver a modificar cualquier sección antes de confirmar.
        </p>
      </div>

      <div className="summary-sections space-y-4">
        {sections.map((section) => (
          <section
            key={section.stepId}
            className="summary-section-card bg-white border border-gray-200 rounded-lg p-5 shadow-sm"
          >
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
              <button
                type="button"
                onClick={() => onEditStep(section.stepIndex)}
                disabled={disabled}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                Modificar
              </button>
            </div>

            {section.fields.length > 0 && (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {section.fields.map((f) => (
                  <div key={f.key} className="summary-field">
                    <dt className="text-gray-500 font-medium">{f.label}</dt>
                    <dd className="text-gray-900 font-medium mt-0.5">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {section.documents.length > 0 && (
              <div className="summary-documents mt-4 pt-3 border-t border-gray-50 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Documentación</h4>
                <ul className="space-y-2 text-sm">
                  {section.documents.map((d) => (
                    <li key={d.key} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1">
                      <span className="text-gray-700 font-medium">{d.label}:</span>
                      {d.isDeferred ? (
                        <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded text-xs">
                          Se entregará posteriormente
                        </span>
                      ) : d.files.length > 0 ? (
                        <span className="text-gray-900">
                          {d.files.map((file, idx) => (
                            <span
                              key={idx}
                              className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded ml-1"
                            >
                              {file.name} ({file.sizeFormatted})
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">No informado</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="summary-actions flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={() => onEditStep(0)}
          disabled={disabled}
          className="w-full sm:w-auto px-5 py-2.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Volver a modificar datos
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="wizard-submit-action w-full sm:w-auto px-6 py-2.5 text-sm font-semibold rounded-md shadow-sm transition-colors"
        >
          Confirmar y enviar preinscripción
        </button>
      </div>
    </div>
  );
};
