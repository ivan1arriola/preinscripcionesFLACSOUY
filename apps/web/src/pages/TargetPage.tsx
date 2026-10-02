import React, { useEffect, useState } from 'react';
import type { FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient, ApiError } from '../api/client.js';
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
      const res = await apiClient.submit(targetId, form.configRevision, values, files);
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
      <div className="bg-white p-8 rounded-lg shadow max-w-xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto text-2xl font-bold">
          ✓
        </div>
        <h2 className="text-2xl font-bold text-gray-900">¡Preinscripción enviada con éxito!</h2>
        <p className="text-gray-600">
          Su solicitud ha sido registrada correctamente en el sistema de preinscripciones.
        </p>
        <div className="p-3 bg-gray-50 rounded border text-sm text-gray-700 font-mono">
          Código de seguimiento: {submissionId}
        </div>
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
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          &larr; Volver al listado
        </button>
        <span className="text-xs bg-gray-100 text-gray-700 py-1 px-2.5 rounded font-mono">
          Rev: {form.configRevision}
        </span>
      </div>

      <div>
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
