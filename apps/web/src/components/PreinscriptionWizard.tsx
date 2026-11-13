import React, { useState } from 'react';
import type { FormDefinition, FormStepDefinition, SubmissionFileToken } from '@flacso/contracts';
import { WizardProgress } from './WizardProgress.js';
import { FormStep } from './FormStep.js';
import { PreinscriptionSummary } from './PreinscriptionSummary.js';
import { PreinscriptionLoadingOverlay } from './PreinscriptionLoadingOverlay.js';
import { PreinscriptionStartCard } from './PreinscriptionStartCard.js';
import { MobileWizardNavigation } from './MobileWizardNavigation.js';
import { FormErrorSummary } from './FormErrorSummary.js';
import { FormHelp } from './FormHelp.js';
import { apiClient } from '../api/client.js';
import { withoutExpiredFiles } from '../api/file-errors.js';
import { useUploadKeepAlive } from './useUploadKeepAlive.js';

const NO_EXPIRED_FIELDS: string[] = [];

interface PreinscriptionWizardProps {
  form: FormDefinition;
  onSubmit: (values: Record<string, string>, files: SubmissionFileToken[]) => Promise<void>;
  isSubmitting?: boolean;
  serverErrors?: Record<string, string[]>;
  /** Campos de documentos cuyos archivos venció el servidor: se quitan de pantalla para volver a cargarlos. */
  expiredFields?: string[];
  /** Renueva el vencimiento de los archivos subidos mientras el formulario está abierto. */
  onKeepAlive?: () => Promise<unknown>;
  onUpload?: (fieldKey: string, file: File, onProgress?: (percent: number) => void) => Promise<SubmissionFileToken>;
}

export const PreinscriptionWizard: React.FC<PreinscriptionWizardProps> = ({
  form,
  onSubmit,
  isSubmitting = false,
  serverErrors = {},
  expiredFields = NO_EXPIRED_FIELDS,
  onKeepAlive = () => apiClient.keepAlive(),
  onUpload = (fieldKey, file, onProgress) => apiClient.upload(form.targetId, fieldKey, file, onProgress),
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [highestStepReached, setHighestStepReached] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<SubmissionFileToken[]>([]);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  // El recuadro con la lista de errores aparece solo al intentar avanzar; al salir de un campo
  // se avisa junto al campo, sin mover el resto del formulario.
  const [summaryVisible, setSummaryVisible] = useState(false);

  // Los archivos subidos vencen a los 30 minutos sin actividad: mientras el formulario siga abierto se renuevan.
  useUploadKeepAlive(files.length > 0, onKeepAlive);
  // Si el servidor avisa que algunos ya no existen, se quitan de la pantalla en vez de mostrarlos como cargados.
  React.useEffect(() => {
    if (expiredFields.length > 0) setFiles((current) => withoutExpiredFiles(current, expiredFields));
  }, [expiredFields]);

  const steps: FormStepDefinition[] = form.steps && form.steps.length > 0
    ? [...form.steps].sort((a, b) => a.order - b.order)
    : [
        { id: 'personal', title: 'Datos personales y demográficos', order: 1 },
        { id: 'contacto', title: 'Residencia y contacto', order: 2 },
        { id: 'academico', title: 'Trayectoria académica', order: 3 },
        { id: 'documentos', title: 'Documentación requerida', order: 4 },
        { id: 'declaracion', title: 'Convenios y declaraciones', order: 5 },
      ];

  const currentStep = steps[currentStepIndex] || steps[0]!;

  // Si el servidor rechaza campos al confirmar desde la pantalla de resumen, esa pantalla no los muestra:
  // se vuelve al primer paso con error para que la persona vea qué corregir.
  React.useEffect(() => {
    const fieldKeys = Object.keys(serverErrors).filter((key) => key !== '_form');
    if (!isReviewing || fieldKeys.length === 0) return;

    const stepIdOf = (key: string) =>
      form.inputs.find((input) => input.key === key)?.stepId
      ?? (form.documents ?? []).find((document) => document.key === key)?.stepId;
    const stepIndexes = fieldKeys
      .map((key) => steps.findIndex((step) => step.id === stepIdOf(key)))
      .filter((index) => index >= 0);

    setIsReviewing(false);
    setCurrentStepIndex(stepIndexes.length > 0 ? Math.min(...stepIndexes) : 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [serverErrors]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const validateStep = (stepToValidate: FormStepDefinition): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Get inputs for step
    const stepInputs = form.inputs.filter((i) => {
      if (i.stepId) return i.stepId === stepToValidate.id;
      // Fallback grouping by step id
      if (stepToValidate.id === 'personal' || steps.length <= 2) {
        if (['nombre', 'nombre1', 'nombre2', 'apellido', 'apellido1', 'apellido2', 'fechaNacimiento', 'tipoDocumento', 'documento', 'paisEmisorDocumento', 'genero', 'generoOtra', 'etnia', 'paisNacimiento'].includes(i.key)) {
          return true;
        }
      }
      if (stepToValidate.id === 'contacto') {
        return ['paisResidencia', 'ciudadResidencia', 'domicilio', 'celular', 'telefono', 'email', 'emailConfirmacion', 'ocupacion'].includes(i.key);
      }
      if (stepToValidate.id === 'academico') {
        return ['estudios', 'posgradoFlacso', 'posgradoCual', 'orientacion', 'mencion', 'tituloDenominacion', 'sinTituloActual'].includes(i.key);
      }
      if (stepToValidate.id === 'declaracion') {
        return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion', 'aceptaComunicaciones'].includes(i.key);
      }
      return steps.findIndex((s) => s.id === stepToValidate.id) === 0;
    });

    for (const input of stepInputs) {
      if (input.key === 'tituloDenominacion' || input.key === 'sinTituloActual') continue;
      if (!visibleInput(input.key)) continue;
      if (input.required && !(values[input.key] || '').trim()) {
        errors[input.key] = `El campo ${input.label} es obligatorio.`;
      }
    }

    // Conditional validations by step
    if (stepToValidate.id === 'personal') {
      if (values.genero === 'Otra' && !(values.generoOtra || '').trim()) {
        errors.generoOtra = 'Debe especificar su identidad de género.';
      }
      if (values.tipoDocumento && values.tipoDocumento !== 'cedula_uruguaya' && !(values.paisEmisorDocumento || '').trim()) {
        errors.paisEmisorDocumento = 'Debe especificar el país emisor del documento.';
      }
    }

    if (stepToValidate.id === 'academico') {
      if (values.posgradoFlacso === 'Si' && !(values.posgradoCual || '').trim()) {
        errors.posgradoCual = 'Debe especificar qué posgrado cursó en FLACSO.';
      }
    }

    if (stepToValidate.id === 'orientacion') {
      const hasOrientations = form.inputs.some((input) => input.key === 'orientacion') && (form.orientations ?? []).length > 0;
      const orientacionVal = values.orientacion?.trim();
      if (hasOrientations) {
        if (!orientacionVal) {
          errors.orientacion = 'Debes seleccionar una orientación.';
        } else if (!(form.orientations ?? []).includes(orientacionVal)) {
          errors.orientacion = 'La orientación seleccionada no es válida.';
        }
      }
      const hasMentions = (form.mentions ?? []).length > 0;
      const mencionVal = values.mencion?.trim();
      if (hasMentions && mencionVal && !(form.mentions ?? []).includes(mencionVal)) {
        errors.mencion = 'La mención seleccionada no es válida.';
      }
    }

    if (stepToValidate.id === 'declaracion') {
      if (values.tieneConvenio === 'Si' && !(values.convenioWordpressId || '').trim()) {
        errors.convenioWordpressId = 'Debe seleccionar el convenio correspondiente.';
      }
    }

    // Get documents for step
    const stepDocs = (form.documents ?? []).filter((d) => {
      if (d.stepId) return d.stepId === stepToValidate.id;
      return stepToValidate.id === 'documentos';
    });

    const titleDoc = stepDocs.find((doc) => doc.key === 'titulo');
    if (titleDoc) {
      const isSinTitulo = values.sinTituloActual === 'Si' || values.sinTituloActual === 'true';
      if (!isSinTitulo) {
        if (!(values.tituloDenominacion || '').trim()) {
          errors.tituloDenominacion = 'El campo Denominación del título es obligatorio.';
        }
        if (!files.some((f) => f.fieldKey === 'titulo')) {
          errors.titulo = 'El documento Título de grado o terciario es obligatorio.';
        }
      }
    }

    for (const doc of stepDocs) {
      if (doc.key === 'titulo') continue;
      if (doc.alternative?.kind === 'defer') {
        const isDeferred = values[doc.alternative.valueKey] === 'Si';
        if (!isDeferred && !files.some((f) => f.fieldKey === doc.key)) {
          errors[doc.key] = `El documento ${doc.label} es obligatorio.`;
        }
      } else if (doc.required && !files.some((f) => f.fieldKey === doc.key)) {
        errors[doc.key] = `El documento ${doc.label} es obligatorio.`;
      }
    }

    return errors;
  };

  const validateCurrentStep = (): boolean => {
    const errs = validateStep(currentStep);
    if (Object.keys(errs).length > 0) {
      setClientErrors(errs);
      setSummaryVisible(true);
      return false;
    }
    setClientErrors({});
    setSummaryVisible(false);
    return true;
  };

  // Al salir de un campo se valida solo ese campo, para avisar en el momento y no al final del paso.
  const handleBlurField = (key: string) => {
    const message = validateStep(currentStep)[key];
    setClientErrors((prev) => {
      if (message) return prev[key] === message ? prev : { ...prev, [key]: message };
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateAllSteps = (): boolean => {
    let allErrors: Record<string, string> = {};
    let firstErrorIndex = -1;

    steps.forEach((step, idx) => {
      const stepErrs = validateStep(step);
      if (Object.keys(stepErrs).length > 0) {
        allErrors = { ...allErrors, ...stepErrs };
        if (firstErrorIndex === -1) {
          firstErrorIndex = idx;
        }
      }
    });

    if (firstErrorIndex !== -1) {
      setClientErrors(allErrors);
      setSummaryVisible(true);
      setCurrentStepIndex(firstErrorIndex);
      setIsReviewing(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }

    setClientErrors({});
    return true;
  };

  const handleNext = () => {
    if (!validateCurrentStep()) return;
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < steps.length) {
      setSummaryVisible(false);
      setCurrentStepIndex(nextIdx);
      setHighestStepReached((prev) => Math.max(prev, nextIdx));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setSummaryVisible(false);
      setCurrentStepIndex(currentStepIndex - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepClick = (index: number) => {
    if (index <= highestStepReached) {
      setSummaryVisible(false);
      setIsReviewing(false);
      setCurrentStepIndex(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReview = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validateCurrentStep()) return;
    setIsReviewing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditStep = (stepIndex: number) => {
    setIsReviewing(false);
    setCurrentStepIndex(stepIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFinalConfirm = async () => {
    if (!validateAllSteps()) return;
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
      return ['paisResidencia', 'ciudadResidencia', 'domicilio', 'celular', 'telefono', 'email', 'emailConfirmacion', 'ocupacion'].includes(i.key);
    }
    if (currentStep.id === 'academico') {
      return ['estudios', 'posgradoFlacso', 'posgradoCual', 'orientacion', 'mencion', 'tituloDenominacion', 'sinTituloActual'].includes(i.key);
    }
    if (currentStep.id === 'declaracion') {
      return ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion', 'aceptaComunicaciones'].includes(i.key);
    }
    return currentStepIndex === 0;
  });

  const currentStepDocs = (form.documents ?? []).filter((d) => {
    if (d.stepId) return d.stepId === currentStep.id;
    return currentStep.id === 'documentos';
  });

  const isFinalStep = currentStepIndex === steps.length - 1;

  if (isSubmitting) {
    return <PreinscriptionLoadingOverlay />;
  }

  if (!hasStarted) {
    return (
      <div className="preinscription-wizard">
        <PreinscriptionStartCard
          title={form.title}
          documentSummary={(form.documents ?? []).map((document) => ({
            label: document.label,
            required: document.required,
          }))}
          sectionCount={steps.length}
          onStart={() => setHasStarted(true)}
          disabled={isSubmitting || !form.registrationOpen}
        />
        <FormHelp />
      </div>
    );
  }

  return (
    <div className="preinscription-wizard">
      <WizardProgress
        steps={steps}
        currentStepIndex={currentStepIndex}
        highestStepReached={highestStepReached}
        onStepClick={handleStepClick}
      />

      {isReviewing ? (
        <div className="form-step-card">
          <PreinscriptionSummary
            form={form}
            values={values}
            files={files}
            onEditStep={handleEditStep}
            onConfirm={handleFinalConfirm}
            disabled={isSubmitting || !form.registrationOpen}
          />
          {serverErrors._form && (
            <div className="form-alert" style={{ marginTop: '1rem', marginBottom: 0 }} role="alert">
              {serverErrors._form.join(', ')}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={isFinalStep ? handleReview : (e) => { e.preventDefault(); handleNext(); }}>
          <FormErrorSummary
            errors={summaryVisible ? errors : {}}
            orderedKeys={[...new Set([
              ...currentStepInputs.map((input) => input.key),
              ...currentStepDocs.map((document) => document.key),
              'tituloDenominacion',
            ])]}
            onSelectField={(key) => {
              const element = document.getElementById(`input-${key}`) ?? document.getElementById(`file-${key}`);
              element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              element?.focus();
            }}
          />
          <div className="form-step-card">
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
              onBlurField={handleBlurField}
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
            <div className="form-alert" style={{ marginTop: '1rem' }} role="alert">
              {serverErrors._form.join(', ')}
            </div>
          )}

          <MobileWizardNavigation
            canGoBack={currentStepIndex > 0}
            canContinue={form.registrationOpen}
            isFinalStep={isFinalStep}
            isSubmitting={isSubmitting}
            onBack={handleBack}
            onContinue={isFinalStep ? handleReview : handleNext}
            continueLabel={isFinalStep ? 'Revisar datos' : 'Siguiente'}
          />
        </form>
      )}
      <FormHelp />
    </div>
  );
};
