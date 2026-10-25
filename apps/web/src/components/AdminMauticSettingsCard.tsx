import React, { useEffect, useState } from 'react';
import { apiClient, ApiError, type AdminMauticSettings } from '../api/client.js';

interface AdminMauticSettingsCardProps {
  csrfToken: string;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

function parseTemplateId(value: string): number | null {
  const id = Number(value.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const AdminMauticSettingsCard: React.FC<AdminMauticSettingsCardProps> = ({ csrfToken }) => {
  const [settings, setSettings] = useState<AdminMauticSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [contactsEnabled, setContactsEnabled] = useState(false);
  const [applicantTemplateId, setApplicantTemplateId] = useState('');
  const [teamTemplateId, setTeamTemplateId] = useState('');
  const [enrollmentNotifyEnabled, setEnrollmentNotifyEnabled] = useState(false);
  const [enrollmentSecret, setEnrollmentSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applySettings = (mautic: AdminMauticSettings) => {
    setSettings(mautic);
    setBaseUrl(mautic.baseUrl);
    setClientId(mautic.clientId);
    setClientSecret('');
    setContactsEnabled(mautic.contactsEnabled);
    setApplicantTemplateId(mautic.applicantTemplateId ? String(mautic.applicantTemplateId) : '');
    setTeamTemplateId(mautic.teamTemplateId ? String(mautic.teamTemplateId) : '');
    setEnrollmentNotifyEnabled(mautic.enrollmentNotifyEnabled);
    setEnrollmentSecret('');
  };

  useEffect(() => {
    apiClient
      .getMauticSettings()
      .then((data) => applySettings(data.mautic))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Error al cargar la configuración de Mautic'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiClient.updateMauticSettings(csrfToken, {
        baseUrl,
        clientId,
        clientSecret,
        contactsEnabled,
        applicantTemplateId: parseTemplateId(applicantTemplateId),
        teamTemplateId: parseTemplateId(teamTemplateId),
        enrollmentNotifyEnabled,
        enrollmentSecret,
      });
      applySettings(res.mautic);
      setSuccess(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar la configuración de Mautic');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      setSuccess((await apiClient.testMauticSettings(csrfToken)).message);
      applySettings((await apiClient.getMauticSettings()).mautic);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con Mautic');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
        <p className="text-gray-500 text-sm">Cargando configuración de Mautic...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      <div className="mb-4 pb-3 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span>📇</span> Mautic
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Registra a cada postulante como contacto (con tags de la oferta o el seminario), permite enviar las notificaciones con plantillas de Mautic y avisa cada inscripción para que la persona deje de recibir la campaña de seguimiento de esa oferta. Los postulantes no se inscriben en campañas.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{success}</div>}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="mautic-base-url" className="block text-xs font-semibold text-gray-700 mb-1">URL de Mautic</label>
          <input id="mautic-base-url" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mautic.flacso.edu.uy" className={inputClass} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mautic-client-id" className="block text-xs font-semibold text-gray-700 mb-1">Clave Pública</label>
            <input id="mautic-client-id" type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" className={`${inputClass} font-mono`} />
          </div>
          <div>
            <label htmlFor="mautic-client-secret" className="block text-xs font-semibold text-gray-700 mb-1">Clave Secreta</label>
            <input
              id="mautic-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
              placeholder={settings?.hasClientSecret ? '•••••••• (guardada; dejar vacío para conservarla)' : ''}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mautic-applicant-template" className="block text-xs font-semibold text-gray-700 mb-1">ID de plantilla para el postulante</label>
            <input id="mautic-applicant-template" type="number" min={1} value={applicantTemplateId} onChange={(e) => setApplicantTemplateId(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="mautic-team-template" className="block text-xs font-semibold text-gray-700 mb-1">ID de plantilla para el equipo</label>
            <input id="mautic-team-template" type="number" min={1} value={teamTemplateId} onChange={(e) => setTeamTemplateId(e.target.value)} className={inputClass} />
          </div>
        </div>
        <p className="text-[11px] text-gray-500">
          Las plantillas deben incluir los tokens <code>{'{preinscripcion_contenido}'}</code>, <code>{'{preinscripcion_asunto}'}</code>, <code>{'{preinscripcion_texto}'}</code> y <code>{'{preinscripcion_id}'}</code>. Para enviar con Mautic, elegí “Mautic” como proveedor en la tarjeta de notificaciones.
        </p>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={contactsEnabled} onChange={(e) => setContactsEnabled(e.target.checked)} className="mt-1" />
          <span>Registrar a cada postulante como contacto en Mautic</span>
        </label>
        <div className="pt-3 border-t border-gray-100 space-y-3">
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={enrollmentNotifyEnabled} onChange={(e) => setEnrollmentNotifyEnabled(e.target.checked)} className="mt-1" />
            <span>
              Avisar cada inscripción a una oferta, para cortar su campaña de seguimiento
              <span className="block text-[11px] text-gray-500">
                Se envía aunque el postulante no acepte comunicaciones: Mautic sólo actúa si la persona ya es contacto y nunca crea contactos con este aviso.
              </span>
            </span>
          </label>
          <div>
            <label htmlFor="mautic-enrollment-secret" className="block text-xs font-semibold text-gray-700 mb-1">Secreto del aviso de inscripción</label>
            <input
              id="mautic-enrollment-secret"
              type="password"
              value={enrollmentSecret}
              onChange={(e) => setEnrollmentSecret(e.target.value)}
              autoComplete="new-password"
              minLength={32}
              placeholder={settings?.hasEnrollmentSecret ? '•••••••• (guardado; dejar vacío para conservarlo)' : 'Mínimo 32 caracteres'}
              className={`${inputClass} font-mono`}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Debe ser idéntico a <code>flacso_enrollment_secret</code> en la configuración del plugin de Mautic.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors shadow-sm">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={handleTest} disabled={testing || !settings?.hasClientSecret} className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:text-gray-400 text-gray-800 font-medium text-xs rounded-lg transition-colors">
            {testing ? 'Probando...' : 'Probar conexión'}
          </button>
        </div>
      </form>

      {settings?.lastTestedAt && (
        <div className={`mt-4 p-3 rounded-lg border text-xs ${settings.lastTestStatus === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          Última prueba: {new Date(settings.lastTestedAt).toLocaleString('es-UY')} —{' '}
          {settings.lastTestStatus === 'ok' ? 'conexión correcta' : settings.lastTestError || 'error'}
        </div>
      )}
    </div>
  );
};
