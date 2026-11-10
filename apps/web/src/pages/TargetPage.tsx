import { trackSubmitApplication } from '../api/meta-pixel.js';
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
      if (!res.existing) void trackSubmitApplication(res.submissionId, form.title);
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
      <div className="loading-screen" role="status">
        <div className="loading-card">
          <div className="loading-spinner" aria-hidden="true" />
          <p>Cargando formulario de preinscripción...</p>
        </div>
      </div>
    );
  }

  if (submissionId) {
    return (
      <div className="success-card">
        <div className="success-card__icon" aria-hidden="true">
          ✓
        </div>
        <h2>¡Preinscripción enviada con éxito!</h2>
        <p className="success-card__lead">
          Tu solicitud fue registrada correctamente. Guardá el código para consultar el estado de tu preinscripción.
        </p>
        <div className="tracking-box">
          <span className="tracking-box__label">Código de seguimiento</span>
          <div className="tracking-box__row">
            <code>{submissionId}</code>
            <button
              type="button"
              onClick={copyTrackingCode}
              className="btn btn-secondary"
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
        {pendingProcessing && (
          <p className="success-card__note" role="status">
            Recibimos tu preinscripción, pero su procesamiento técnico quedó pendiente. El equipo de FLACSO la
            completará: no hace falta que la vuelvas a enviar. Guardá el código de seguimiento.
          </p>
        )}
        <ul className="success-next">
          <li>El equipo de FLACSO revisará la información y se comunicará contigo si necesita algo más.</li>
        </ul>
        <button
          type="button"
          onClick={onBack}
          className="btn btn-primary"
        >
          Volver a la lista de destinos
        </button>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="page-notice page-notice--error" role="alert">
        <div>
          <h2>No se puede acceder a este formulario</h2>
          <p>{error}</p>
          {issues.length > 0 && (
            <ul>
              {issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onBack}
            className="btn btn-secondary"
          >
            &larr; Volver al listado de destinos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="target-page">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="target-back-link btn btn-text"
        >
          &larr; Volver al listado
        </button>
      </div>

      <div className="target-page-heading">
        <span className="target-page-eyebrow">Preinscripción</span>
        <h2>{form.title}</h2>
        <p>
          Completá los campos solicitados a continuación para registrar tu preinscripción.
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
