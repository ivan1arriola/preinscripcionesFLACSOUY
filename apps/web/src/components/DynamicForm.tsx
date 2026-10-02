import React, { useState } from 'react';
import type { FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { OrientationMentionFields } from './OrientationMentionFields.js';
import { UniversalFields } from './UniversalFields.js';
import { DocumentUploadFields } from './DocumentUploadFields.js';
import { PreinscriptionWizard } from './PreinscriptionWizard.js';

interface DynamicFormProps {
  form: FormDefinition;
  onSubmit: (values: Record<string, string>, files?: SubmissionFileToken[]) => Promise<void>;
  isSubmitting?: boolean;
  serverErrors?: Record<string, string[]>;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({ form, onSubmit, isSubmitting = false, serverErrors = {} }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<SubmissionFileToken[]>([]);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const hasOrientationInput = form.inputs.some((input) => input.key === 'orientacion');
  const hasMentionInput = form.inputs.some((input) => input.key === 'mencion');
  const orientacionInput = form.inputs.find((input) => input.key === 'orientacion');
  const mencionInput = form.inputs.find((input) => input.key === 'mencion');

  const handleInputChange = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setClientErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  };

  const visibleInput = (key: string) => {
    if (key === 'generoOtra') return values.genero === 'Otra';
    if (key === 'convenioWordpressId') return values.tieneConvenio === 'Si';
    if (key === 'posgradoCual') return values.posgradoFlacso === 'Si';
    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.registrationOpen) return;
    const errors: Record<string, string> = {};
    for (const input of form.inputs) {
      if (!visibleInput(input.key)) continue;
      if (input.required && !(values[input.key] || '').trim()) errors[input.key] = `El campo ${input.label} es obligatorio.`;
    }
    for (const document of form.documents ?? []) {
      if (document.required && !document.canDefer && !files.some((file) => file.fieldKey === document.key)) {
        errors[document.key] = `El documento ${document.label} es obligatorio.`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return;
    }
    setClientErrors({});
    await onSubmit(values, files);
  };

  if (form.steps && form.steps.length > 0) {
    return (
      <PreinscriptionWizard
        form={form}
        onSubmit={(vals, fls) => onSubmit(vals, fls)}
        isSubmitting={isSubmitting}
        serverErrors={serverErrors}
      />
    );
  }

  const errors: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(clientErrors)) errors[key] = value;
  for (const [key, messages] of Object.entries(serverErrors)) errors[key] = messages.join(', ');
  const regularInputs = form.inputs.filter((input) => input.key !== 'orientacion' && input.key !== 'mencion');

  return <form onSubmit={handleSubmit} className="space-y-6 bg-white p-6 rounded-lg shadow">
    {!form.registrationOpen && <div className="p-4 mb-4 text-sm text-amber-800 rounded-lg bg-amber-50 border border-amber-200" role="alert"><strong>Preinscripción cerrada:</strong> Este destino académico no se encuentra aceptando preinscripciones actualmente.</div>}
    {serverErrors._form && <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 border border-red-200" role="alert">{serverErrors._form.join(', ')}</div>}
    <UniversalFields inputs={regularInputs} values={values} errors={errors} disabled={!form.registrationOpen || isSubmitting} onChange={handleInputChange} />
    {(hasOrientationInput || hasMentionInput) && (form.orientations.length > 0 || (form.mentions?.length ?? 0) > 0) && <OrientationMentionFields
      orientations={form.orientations}
      mentions={form.mentions ?? []}
      selectedOrientation={values.orientacion || ''}
      selectedMention={values.mencion || ''}
      onOrientationChange={(value) => handleInputChange('orientacion', value)}
      onMentionChange={(value) => handleInputChange('mencion', value)}
      orientationRequired={orientacionInput?.required ?? true}
      mentionRequired={mencionInput?.required ?? false}
      orientationError={errors.orientacion}
      mentionError={errors.mencion}
      disabled={!form.registrationOpen || isSubmitting}
    />}
    <DocumentUploadFields
      documents={form.documents ?? []}
      files={files}
      disabled={!form.registrationOpen || isSubmitting}
      errors={errors}
      onUpload={(fieldKey, file) => apiClient.upload(form.targetId, fieldKey, file)}
      onFileToken={(file) => setFiles((current) => {
        const definition = (form.documents ?? []).find((document) => document.key === file.fieldKey);
        if (definition?.maxFiles === 1) return [...current.filter((item) => item.fieldKey !== file.fieldKey), file];
        return [...current, file];
      })}
      onRemoveToken={(file) => setFiles((current) => current.filter((item) => item.token !== file.token))}
    />
    <div className="pt-4"><button type="submit" disabled={!form.registrationOpen || isSubmitting} className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{isSubmitting ? 'Enviando preinscripción...' : form.registrationOpen ? 'Enviar preinscripción' : 'Inscripción cerrada'}</button></div>
  </form>;
};
