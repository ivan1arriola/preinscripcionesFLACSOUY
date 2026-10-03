import React, { useState } from 'react';
import type { FormDefinition, FormStepDefinition, SubmissionFileToken } from '@flacso/contracts';
import { WizardProgress } from './WizardProgress.js';
import { FormStep } from './FormStep.js';
import { apiClient } from '../api/client.js';

interface PreinscriptionWizardProps {
  form: FormDefinition;
  onSubmit: (values: Record<string, string>, files: SubmissionFileToken[]) => Promise<void>;
  isSubmitting?: boolean;
  serverErrors?: Record<string, string[]>;
  onUpload?: (fieldKey: string, file: File) => Promise<SubmissionFileToken>;
}

export const PreinscriptionWizard: React.FC<PreinscriptionWizardProps> = ({
  form,
  onSubmit,
  isSubmitting = false,
  serverErrors = {},
  onUpload = (fieldKey, file) => apiClient.upload(form.targetId, fieldKey, file),
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [highestStepReached, setHighestStepReached] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<SubmissionFileToken[]>([]);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Ensure steps include confirmation as the final step
  const rawSteps: FormStepDefinition[] = form.steps && form.steps.length > 0
    ? [...form.steps].sort((a, b) => a.order - b.order)
    : [
        { id: 'personal', title: 'Datos personales', order: 1 },
        { id: 'contacto', title: 'Contacto', order: 2 },
        { id: 'academico', title: 'Formación académica', order: 3 },
        { id: 'documentos', title: 'Documentación', order: 4 },
      ];

  const steps: FormStepDefinition[] = rawSteps.some((s) => s.id === 'confirmacion')
    ? rawSteps
    : [...rawSteps, { id: 'confirmacion', title: 'Confirmación', order: 99 }];

  const currentStep = steps[currentStepIndex] || steps[0]!;

  const handleInputChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setClientErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleFileToken = (token: SubmissionFileToken) => {
    setFiles((prev) => [...prev.filter((f) => f.token !== token.token), token]);
    setClientErrors((prev) => {
      const next = { ...prev };
      delete next[token.fieldKey];
      return next;
    });
  };

  const handleRemoveToken = (token: SubmissionFileToken) => {
    setFiles((prev) => prev.filter((f) => f.token !== token.token));
  };

  const visibleInput = (key: string) => {
    if (key === 'generoOtra') return values.genero === 'Otra';
    if (key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
    if (key === 'posgradoCual') return values.posgradoFlacso === 'Si';
    if (key === 'paisEmisorDocumento') return values.tipoDocumento !== 'cedula_uruguaya';
    return true;
  };

  const validateCurrentStep = (): boolean => {
    const errors: Record<string, string> = {};

    // Get inputs for current step
    const stepInputs = form.inputs.filter((i) => {
      if (i.stepId) return i.stepId === currentStep.id;
      // Fallback grouping by step id
      if (currentStep.id === 'personal' || steps.length <= 2) {
        if (['nombre', 'nombre1', 'nombre2', 'apellido', 'apellido1', 'apellido2', 'fechaNacimiento', 'tipoDocumento', 'documento', 'paisEmisorDocumento', 'genero', 'generoOtra', 'etnia', 'paisNacimiento'].includes(i.key)) {
          return true;
        }
      }
      if (currentStep.id === 'contacto') {
        return ['paisResidencia', 'domicilio', 'celular', 'telefono', 'email', 'emailConfirmacion', 'ocupacion'].includes(i.key);
      }
      if (currentStep.id === 'academico') {
        return ['estudios', 'posgradoFlacso', 'posgradoCual', 'titulo', 'escolaridad', 'institucion', 'orientacion', 'mencion'].includes(i.key);
      }
      if (currentStep.id === 'declaracion') {
        return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion'].includes(i.key);
      }
      // If it's a 1-step profile (plus confirm), include any unassigned regular inputs in step 0
      return currentStepIndex === 0;
    });

    for (const input of stepInputs) {
      if (!visibleInput(input.key)) continue;
      if (input.required && !(values[input.key] || '').trim()) {
        errors[input.key] = `El campo ${input.label} es obligatorio.`;
      }
    }

    // Required orientations check if in academic step
    const hasOrientations = (form.orientations ?? []).length > 0;
    if (currentStep.id === 'academico' && hasOrientations) {
      if (!(values.orientacion || '').trim()) {
        errors.orientacion = 'Debes seleccionar una orientación.';
      }
    }

    // Get documents for current step
    const stepDocs = (form.documents ?? []).filter((d) => {
      if (d.stepId) return d.stepId === currentStep.id;
      return currentStep.id === 'documentos';
    });

    for (const doc of stepDocs) {
      if (doc.required && !doc.canDefer && !files.some((f) => f.fieldKey === doc.key)) {
        errors[doc.key] = `El documento ${doc.label} es obligatorio.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return false;
    }

    setClientErrors({});
    return true;
  };

  const handleNext = () => {
    if (!validateCurrentStep()) return;
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < steps.length) {
      setCurrentStepIndex(nextIdx);
      setHighestStepReached((prev) => Math.max(prev, nextIdx));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepClick = (index: number) => {
    if (index <= highestStepReached) {
      setCurrentStepIndex(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.registrationOpen) return;
    await onSubmit(values, files);
  };

  // Combine errors
  const errors: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(clientErrors)) errors[k] = v;
  for (const [k, v] of Object.entries(serverErrors)) errors[k] = v.join(', ');

  // Inputs and documents for current step
  const currentStepInputs = form.inputs.filter((i) => {
    if (i.stepId) return i.stepId === currentStep.id;
    if (currentStep.id === 'personal' || steps.length <= 2) {
      if (['nombre', 'nombre1', 'nombre2', 'apellido', 'apellido1', 'apellido2', 'fechaNacimiento', 'tipoDocumento', 'documento', 'paisEmisorDocumento', 'genero', 'generoOtra', 'etnia', 'paisNacimiento'].includes(i.key)) {
        return true;
      }
    }
    if (currentStep.id === 'contacto') {
      return ['paisResidencia', 'domicilio', 'celular', 'telefono', 'email', 'emailConfirmacion', 'ocupacion'].includes(i.key);
    }
    if (currentStep.id === 'academico') {
      return ['estudios', 'posgradoFlacso', 'posgradoCual', 'titulo', 'escolaridad', 'institucion', 'orientacion', 'mencion'].includes(i.key);
    }
    if (currentStep.id === 'declaracion') {
      return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion'].includes(i.key);
    }
    return currentStepIndex === 0;
  });

  const currentStepDocs = (form.documents ?? []).filter((d) => {
    if (d.stepId) return d.stepId === currentStep.id;
    return currentStep.id === 'documentos';
  });

  const isFinalStep = currentStepIndex === steps.length - 1;

  return (
    <div className="preinscription-wizard mx-auto py-4">
      <WizardProgress
        steps={steps}
        currentStepIndex={currentStepIndex}
        highestStepReached={highestStepReached}
        onStepClick={handleStepClick}
      />

      <form onSubmit={isFinalStep ? handleFinalSubmit : (e) => { e.preventDefault(); handleNext(); }}>
        <div className="form-step-card bg-white shadow rounded-lg p-6 mb-6">
          <FormStep
            step={currentStep}
            inputs={currentStepInputs}
            documents={currentStepDocs}
            values={values}
            allInputs={form.inputs}
            allDocuments={form.documents ?? []}
            errors={errors}
            disabled={isSubmitting || !form.registrationOpen}
            onChange={handleInputChange}
            files={files}
            onUpload={onUpload}
            onFileToken={handleFileToken}
            onRemoveToken={handleRemoveToken}
            orientations={form.orientations ?? []}
            mentions={form.mentions ?? []}
            agreements={form.agreements ?? []}
          />
        </div>

        {serverErrors._form && (
          <div className="mb-4 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
            {serverErrors._form.join(', ')}
          </div>
        )}

        <div className="flex justify-between items-center pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStepIndex === 0 || isSubmitting}
            className={`px-4 py-2 text-sm font-medium rounded-md border ${
              currentStepIndex === 0
                ? 'invisible'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            ← Anterior
          </button>

          {!isFinalStep ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={isSubmitting || !form.registrationOpen}
              className="px-6 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
            >
              Siguiente →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={isSubmitting || !form.registrationOpen}
              className="px-6 py-2 text-sm font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 shadow-sm transition-colors"
            >
              {isSubmitting ? 'Enviando preinscripción…' : 'Confirmar y Enviar'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
