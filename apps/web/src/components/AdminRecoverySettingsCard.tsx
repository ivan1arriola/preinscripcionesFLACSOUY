import React, { useState, useEffect } from 'react';
import {
  apiClient,
  ApiError,
  type AdminTelegramSettings,
} from '../api/client.js';

interface AdminRecoverySettingsCardProps {
  csrfToken: string;
}

export const AdminRecoverySettingsCard: React.FC<AdminRecoverySettingsCardProps> = ({ csrfToken }) => {
  const [settings, setSettings] = useState<AdminTelegramSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [enabled, setEnabled] = useState(false);
  const [preinscriptionEnabled, setPreinscriptionEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [replaceToken, setReplaceToken] = useState(false);
  const [chatIdsInput, setChatIdsInput] = useState('');
  const [testChatId, setTestChatId] = useState('');

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getTelegramSettings();
      setSettings(data.telegram);
      setEnabled(data.telegram.enabled);
      setPreinscriptionEnabled(data.telegram.preinscriptionEnabled ?? false);
      setReplaceToken(false);
      setBotToken('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al cargar la configuración de Telegram');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const parsedChatIds = chatIdsInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      const res = await apiClient.updateTelegramSettings(csrfToken, {
        enabled,
        preinscriptionEnabled,
        botToken: replaceToken || !settings?.hasToken ? botToken.trim() : undefined,
        replaceToken: settings?.hasToken ? replaceToken : undefined,
        chatIds: parsedChatIds.length > 0 ? parsedChatIds : undefined,
      });

      setSettings(res.telegram);
      setEnabled(res.telegram.enabled);
      setPreinscriptionEnabled(res.telegram.preinscriptionEnabled ?? false);
      setReplaceToken(false);
      setBotToken('');
      setChatIdsInput('');
      setSuccess('Configuración de alertas por Telegram guardada correctamente.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar la configuración de Telegram');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiClient.testTelegramSettings(csrfToken, {
        chatId: testChatId.trim() || undefined,
      });
      setSuccess(res.message);
      await loadSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al enviar mensaje de prueba por Telegram');
      await loadSettings();
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
        <p className="text-gray-500 text-sm">Cargando configuración de Telegram...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-200 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>📢</span> Alertas de Incidentes por Telegram
          </h2>
          <p className="text-xs text-gray-600 mt-1">
            Notifica fallos técnicos de Google Drive o Sheets a administradores mediante un bot de Telegram. Los mensajes nunca contienen datos personales ni sensibles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              settings?.enabled
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {settings?.enabled ? '● Alertas activas' : '○ Alertas desactivadas'}
          </span>
          {settings?.hasToken ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
              Bot configurado
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-800 border border-yellow-200">
              Sin token de bot
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 rounded-md bg-green-50 border border-green-200 text-green-800 text-xs">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Habilitar / Deshabilitar Alertas de Recuperación */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <label htmlFor="telegram-enabled-toggle" className="text-sm font-semibold text-gray-900 cursor-pointer">
              Habilitar alertas de recuperación automáticas
            </label>
            <p className="text-xs text-gray-500">
              Al producirse un fallo al procesar una preinscripción, se encolará una notificación operacional inmediata.
            </p>
          </div>
          <input
            id="telegram-enabled-toggle"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </div>

        {/* Habilitar / Deshabilitar Notificaciones de Preinscripción */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div>
            <label htmlFor="telegram-preinscription-toggle" className="text-sm font-semibold text-gray-900 cursor-pointer">
              Notificar cada preinscripción por Telegram
            </label>
            <p className="text-xs text-gray-500">
              Envía una alerta operativa mínima por cada preinscripción confirmada a los chats configurados.
            </p>
          </div>
          <input
            id="telegram-preinscription-toggle"
            type="checkbox"
            checked={preinscriptionEnabled}
            onChange={(e) => setPreinscriptionEnabled(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </div>

        {/* Token del Bot */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-700">
            Token del Bot de Telegram (HTTP API)
          </label>
          {settings?.hasToken && !replaceToken ? (
            <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
              <span className="text-xs text-gray-600">●●●●●●●●●● (Token cifrado en base de datos)</span>
              <button
                type="button"
                onClick={() => setReplaceToken(true)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Reemplazar token
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                className="w-full text-xs font-mono p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-[11px] text-gray-500">
                Obtené el token creando o consultando tu bot con <span className="font-semibold">@BotFather</span> en Telegram.
              </p>
              {settings?.hasToken && replaceToken && (
                <button
                  type="button"
                  onClick={() => {
                    setReplaceToken(false);
                    setBotToken('');
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Cancelar cambio de token
                </button>
              )}
            </div>
          )}
        </div>

        {/* Destinatarios (Chat IDs) */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-700">
            Destinatarios (Chat IDs)
          </label>
          {settings && settings.maskedChatIds.length > 0 && (
            <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-md text-xs space-y-1">
              <span className="text-gray-500 font-medium">Destinatarios actuales ({settings.chatIdsCount}):</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {settings.maskedChatIds.map((id, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-blue-100 text-blue-800"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          <textarea
            rows={2}
            value={chatIdsInput}
            onChange={(e) => setChatIdsInput(e.target.value)}
            placeholder={
              settings && settings.maskedChatIds.length > 0
                ? 'Ingresá nuevos chat_ids (uno por línea o separados por coma) para reemplazar la lista actual...'
                : 'Ej: 123456789, -100987654321 (uno por línea o separados por coma)'
            }
            className="w-full text-xs font-mono p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-[11px] text-gray-500">
            Identificadores numéricos de chat o grupo. Cada usuario o grupo debe haber iniciado al bot con <span className="font-mono">/start</span> para que Telegram permita el envío.
          </p>
        </div>

        {/* Estado y diagnóstico */}
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1.5">
          <div className="font-semibold text-gray-700">Estado de conectividad y pruebas:</div>
          <div className="flex flex-wrap items-center gap-4 text-gray-600">
            <div>
              Última prueba:{' '}
              {settings?.lastTestedAt ? (
                <span className="font-medium text-gray-900">
                  {new Date(settings.lastTestedAt).toLocaleString()}
                </span>
              ) : (
                <span className="text-gray-400">Sin pruebas registradas</span>
              )}
            </div>
            {settings?.lastTestStatus && (
              <div>
                Resultado:{' '}
                {settings.lastTestStatus === 'ok' ? (
                  <span className="text-green-700 font-semibold">✓ Exitosa</span>
                ) : (
                  <span className="text-red-700 font-semibold">✗ Fallida</span>
                )}
              </div>
            )}
          </div>
          {settings?.lastTestError && (
            <div className="mt-1 text-red-600 text-[11px] font-mono bg-red-50 p-2 rounded border border-red-100">
              Error: {settings.lastTestError}
            </div>
          )}
        </div>

        {/* Botones de acción */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Chat ID para prueba (opcional)"
              value={testChatId}
              onChange={(e) => setTestChatId(e.target.value)}
              className="text-xs font-mono p-1.5 border border-gray-300 rounded w-48 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || (!settings?.hasToken && !botToken.trim())}
              className="px-3 py-2 border border-gray-300 text-gray-700 bg-white rounded-md text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {testing ? 'Enviando prueba...' : 'Enviar mensaje de prueba'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
