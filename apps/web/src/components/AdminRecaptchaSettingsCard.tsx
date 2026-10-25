import React, { useEffect, useState } from 'react';
import { apiClient, ApiError, type AdminRecaptchaSettings } from '../api/client.js';

interface AdminRecaptchaSettingsCardProps {
  csrfToken: string;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

export const AdminRecaptchaSettingsCard: React.FC<AdminRecaptchaSettingsCardProps> = ({ csrfToken }) => {
  const [settings, setSettings] = useState<AdminRecaptchaSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [minScore, setMinScore] = useState('0.5');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applySettings = (recaptcha: AdminRecaptchaSettings) => {
    setSettings(recaptcha);
    setEnabled(recaptcha.enabled);
    setSiteKey(recaptcha.siteKey);
    setSecretKey('');
    setMinScore(String(recaptcha.minScore));
  };

  useEffect(() => {
    apiClient
      .getRecaptchaSettings()
      .then((data) => applySettings(data.recaptcha))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Error al cargar la configuración de reCAPTCHA'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiClient.updateRecaptchaSettings(csrfToken, {
        enabled,
        siteKey,
        secretKey,
        minScore: Number(minScore),
      });
      applySettings(res.recaptcha);
      setSuccess(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar la configuración de reCAPTCHA');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
        <p className="text-gray-500 text-sm">Cargando configuración de reCAPTCHA...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      <div className="mb-4 pb-3 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span>🤖</span> Protección anti-spam (Google reCAPTCHA v3)
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Verifica que cada preinscripción la envía una persona, sin pedirle que resuelva ningún desafío. Evita que el
          formulario se use para mandar correos a terceros o llenar las planillas con datos falsos.
        </p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs" role="alert">{error}</div>}
      {success && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs" role="status">{success}</div>}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="recaptcha-site-key" className="block text-xs font-semibold text-gray-700 mb-1">Clave del sitio</label>
            <input
              id="recaptcha-site-key"
              type="text"
              value={siteKey}
              onChange={(e) => setSiteKey(e.target.value)}
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="recaptcha-secret-key" className="block text-xs font-semibold text-gray-700 mb-1">Clave secreta</label>
            <input
              id="recaptcha-secret-key"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="new-password"
              placeholder={settings?.hasSecretKey ? '•••••••• (guardada; dejar vacío para conservarla)' : ''}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
        <div className="max-w-xs">
          <label htmlFor="recaptcha-min-score" className="block text-xs font-semibold text-gray-700 mb-1">Puntaje mínimo (0,1 a 0,9)</label>
          <input
            id="recaptcha-min-score"
            type="number"
            min={0.1}
            max={0.9}
            step={0.1}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            className={inputClass}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Google puntúa cada envío de 0 (robot) a 1 (persona). Con 0,5 se bloquea lo claramente automatizado; subilo si sigue entrando spam.
          </p>
        </div>
        <p className="text-[11px] text-gray-500">
          Creá las claves en la consola de reCAPTCHA de Google eligiendo <strong>reCAPTCHA v3</strong> y agregá el dominio
          del sitio de preinscripciones. Si Google no responde, el formulario sigue funcionando sin verificar.
        </p>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1" />
          <span>Exigir reCAPTCHA en el envío de preinscripciones</span>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors shadow-sm"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>

      <div
        className={`mt-4 p-3 rounded-lg border text-xs ${
          settings?.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        {settings?.enabled
          ? 'reCAPTCHA está activo: los envíos sin una verificación válida se rechazan.'
          : 'reCAPTCHA está desactivado: el formulario público acepta envíos sin verificación.'}
      </div>
    </div>
  );
};
