import React, { useEffect, useRef, useState } from 'react';
import type { FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient, ApiError } from '../api/client.js';
import { getRecaptchaToken } from '../api/recaptcha.js';
import { DynamicForm } from '../components/DynamicForm.js';

interface TargetPageProps {
  targetId: string;
  onBack: () => void;
}

export const TargetPage: React.FC<TargetPageProps> = ({ targetId, onBack }) => {
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [pendingProcessing, setPendingProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  // Un identificador por intento de envío: si la red falla o se vuelve a pulsar "Enviar", el servidor
  // reconoce el reintento y no duplica la fila de la planilla ni los correos.
  const clientSubmissionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const copyTrackingCode = async () => {
    if (!submissionId || !navigator.clipboard) return;
    await navigator.clipboard.writeText(submissionId);
    setCopied(true);
  };

  useEffect(() => {
    let mounted = true;
    apiClient
      .getTarget(targetId)
      .then((data) => {
        if (mounted) {
          setForm(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          if (err instanceof ApiError) {
            setError(err.message);
            if (err.issues) setIssues(err.issues);
          } else {
            setError('Error al cargar la información del destino.');
          }
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [targetId]);

  const handleSubmit = async (values: Record<string, string>, files: SubmissionFileToken[] = []) => {
    if (!form) return;
    setIsSubmitting(true);
    setServerErrors({});

    try {
      const recaptchaToken = await getRecaptchaToken();
      const res = await apiClient.submit(targetId, form.effectiveRevision, values, files, clientSubmissionIdRef.current, recaptchaToken);
      setPendingProcessing(res.status === 'pending_processing');
      setSubmissionId(res.submissionId);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fieldErrors) {
          setServerErrors(err.fieldErrors);
        } else {
          setServerErrors({ _form: [err.message] });
        }
      } else {
        setServerErrors({ _form: ['Ocurrió un error inesperado al enviar el formulario.'] });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Cargando formulario de preinscripción...</p>
      </div>
    );
  }

  if (submissionId) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-xl shadow max-w-xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto text-2xl font-bold">
          ✓
        </div>
        <h2 className="text-2xl font-bold text-gray-900">¡Preinscripción enviada con éxito!</h2>
        <p className="text-gray-600">
          Tu solicitud fue registrada correctamente. Guardá el código para consultar el estado de tu preinscripción.
        </p>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-left">
          <span className="block text-xs font-semibold uppercase tracking-wide text-blue-800">Código de seguimiento</span>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-sm font-semibold text-blue-950">{submissionId}</code>
            <button
              type="button"
              onClick={copyTrackingCode}
              className="min-h-11 shrink-0 rounded-md border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50"
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
        {pendingProcessing && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900" role="status">
            Recibimos tu preinscripción, pero su procesamiento técnico quedó pendiente. El equipo de FLACSO la
            completará: no hace falta que la vuelvas a enviar. Guardá el código de seguimiento.
          </p>
        )}
        <p className="text-sm text-gray-600">El equipo de FLACSO revisará la información y se comunicará contigo si necesita algo más.</p>
        <div className="pt-4">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
          >
            Volver a la lista de destinos
          </button>
        </div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200">
          <p className="font-bold">No se puede acceder a este formulario</p>
          <p className="mt-1">{error}</p>
          {issues.length > 0 && (
            <ul className="list-disc list-inside mt-2 text-sm">
              {issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-blue-600 hover:underline"
        >
          &larr; Volver al listado de destinos
        </button>
      </div>
    );
  }

  return (
    <div className="target-page space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onBack}
          className="target-back-link text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          &larr; Volver al listado
        </button>
      </div>

      <div className="target-page-heading">
        <span className="target-page-eyebrow">Preinscripción</span>
        <h2 className="text-2xl font-bold text-gray-900">{form.title}</h2>
        <p className="text-gray-600 text-sm mt-1">
          Complete los campos solicitados a continuación para registrar su preinscripción.
        </p>
      </div>

      <DynamicForm
        form={form}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        serverErrors={serverErrors}
      />
    </div>
  );
};
