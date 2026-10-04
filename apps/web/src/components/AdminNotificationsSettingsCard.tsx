import React, { useState, useEffect } from 'react';
import {
  apiClient,
  ApiError,
  type AdminEmailSettings,
  type AdminNotificationRecord,
  type AdminNotificationCounts,
} from '../api/client.js';

interface AdminNotificationsSettingsCardProps {
  csrfToken: string;
}

export const AdminNotificationsSettingsCard: React.FC<AdminNotificationsSettingsCardProps> = ({ csrfToken }) => {
  const [settings, setSettings] = useState<AdminEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form fields
  const [enabled, setEnabled] = useState(false);
  const [region, setRegion] = useState('us-east-1');
  const [fromEmail, setFromEmail] = useState('');
  const [replyToEmail, setReplyToEmail] = useState('');
  const [configurationSet, setConfigurationSet] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [masterEmailsText, setMasterEmailsText] = useState('');

  // Test email state
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Outbox / notifications list state
  const [counts, setCounts] = useState<AdminNotificationCounts>({
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    unknown: 0,
    total: 0,
  });
  const [notifications, setNotifications] = useState<AdminNotificationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loadingOutbox, setLoadingOutbox] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);

  // Unknown confirmation modal
  const [retryTarget, setRetryTarget] = useState<AdminNotificationRecord | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      const data = await apiClient.getAdminEmailSettings();
      setSettings(data);
      setEnabled(data.enabled);
      setRegion(data.region || 'us-east-1');
      setFromEmail(data.ses.fromEmail || '');
      setReplyToEmail(data.ses.replyToEmail || '');
      setConfigurationSet(data.configurationSet || '');
      setMasterEmailsText(data.masterEmails.join('\n'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al cargar la configuración de correo');
    }
  };

  const loadNotifications = async (filterStatus?: string) => {
    setLoadingOutbox(true);
    try {
      const data = await apiClient.getAdminNotifications({
        status: filterStatus || undefined,
        limit: 50,
      });
      setCounts(data.counts);
      setNotifications(data.notifications);
    } catch (err) {
      console.error('Error al cargar outbox de notificaciones:', err);
    } finally {
      setLoadingOutbox(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSettings(), loadNotifications()]).finally(() => {
      setLoading(false);
    });
  }, []);

  const handleFilterChange = (newFilter: string) => {
    setStatusFilter(newFilter);
    loadNotifications(newFilter);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const parsedMasters = masterEmailsText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const updated = await apiClient.updateAdminEmailSettings(
        {
          enabled,
          region: region.trim() || undefined,
          fromEmail: fromEmail.trim() || undefined,
          replyToEmail: replyToEmail.trim() || null,
          configurationSet: configurationSet.trim() || null,
          awsAccessKeyId: accessKeyId.trim() || undefined,
          awsSecretAccessKey: secretAccessKey.trim() || undefined,
          awsSessionToken: sessionToken.trim() || null,
          masterEmails: parsedMasters,
        },
        csrfToken
      );

      setSettings(updated);
      setAccessKeyId('');
      setSecretAccessKey('');
      setSessionToken('');
      setSuccess('Configuración de Amazon SES y destinatarios maestros guardada con éxito.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail) return;
    setSendingTest(true);
    setTestResult(null);

    try {
      const res = await apiClient.sendTestAdminEmail(testEmail.trim(), csrfToken);
      setTestResult({
        ok: true,
        message: `Correo de prueba enviado con éxito a ${res.recipient} (ID de mensaje: ${res.providerMessageId})`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof ApiError ? err.message : 'Error al enviar el correo de prueba',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const handleRetry = async (notification: AdminNotificationRecord, force = false) => {
    setRetryingId(notification.id);
    try {
      await apiClient.retryAdminNotification(notification.id, csrfToken, force);
      setRetryTarget(null);
      await loadNotifications(statusFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al reintentar notificación');
    } finally {
      setRetryingId(null);
    }
  };

  const handleDispatchQueue = async () => {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const res = await apiClient.dispatchAdminNotifications(csrfToken);
      setDispatchResult(
        `Despacho procesado: ${res.processed} analizados, ${res.sent} enviados, ${res.failed} fallidos (${res.unknown} desconocidos).`
      );
      await loadNotifications(statusFilter);
    } catch (err) {
      setDispatchResult(err instanceof ApiError ? err.message : 'Error al ejecutar el despacho');
    } finally {
      setDispatching(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
        Cargando configuración de notificaciones SES...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Configuration Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Configuración de Amazon SES y Notificaciones</h2>
            <p className="text-sm text-gray-600">
              Notificaciones transaccionales automáticas para postulantes, coordinaciones y correos institucionales.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                settings?.enabled
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {settings?.enabled ? '● Habilitado' : '○ Deshabilitado'}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                settings?.ses.configured
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {settings?.ses.configured ? 'SES Configurado' : 'SES Pendiente'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm">
            {success}
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Activation Switch */}
          <div className="flex items-start gap-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
            <input
              type="checkbox"
              id="email-enabled-switch"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <label htmlFor="email-enabled-switch" className="text-sm font-semibold text-gray-900 cursor-pointer">
                Habilitar envío automático de notificaciones por correo
              </label>
              <p className="text-xs text-gray-600">
                Al activar esta opción, cada preinscripción completada generará las notificaciones correspondientes para el postulante, la oferta y los destinatarios maestros.
              </p>
            </div>
          </div>

          {/* SES Credentials & Region */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Región de AWS SES
              </label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Configuration Set de SES (opcional)
              </label>
              <input
                type="text"
                value={configurationSet}
                onChange={(e) => setConfigurationSet(e.target.value)}
                placeholder="flacso-notifications"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Remitente (From Email)
              </label>
              <input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder={settings?.ses.fromEmail || 'preinscripciones@flacso.edu.uy'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                required={enabled}
              />
              {settings?.ses.fromEmail && (
                <p className="text-xs text-gray-500 mt-1">
                  Actual: <span className="font-mono">{settings.ses.fromEmail}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Responder a (Reply-To Email, opcional)
              </label>
              <input
                type="email"
                value={replyToEmail}
                onChange={(e) => setReplyToEmail(e.target.value)}
                placeholder={settings?.ses.replyToEmail || 'consultas@flacso.edu.uy'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {settings?.ses.replyToEmail && (
                <p className="text-xs text-gray-500 mt-1">
                  Actual: <span className="font-mono">{settings.ses.replyToEmail}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                AWS Access Key ID
              </label>
              <input
                type="text"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder={settings?.ses.hasAccessKey ? settings.accessKeyIdMasked || '••••••••' : 'AKIA...'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {settings?.ses.hasAccessKey && (
                <p className="text-xs text-gray-500 mt-1">
                  Clave configurada ({settings.accessKeyIdMasked}). Ingrese un nuevo valor solo para reemplazarla.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                AWS Secret Access Key
              </label>
              <input
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder={settings?.ses.hasSecretKey ? '••••••••••••••••' : 'Clave secreta AWS'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {settings?.ses.hasSecretKey && (
                <p className="text-xs text-gray-500 mt-1">
                  Clave secreta configurada y cifrada (AES-256-GCM). Ingrese un nuevo valor solo para reemplazarla.
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                AWS Session Token (opcional, para credenciales temporales o roles asumidos)
              </label>
              <input
                type="password"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                placeholder={settings?.ses.hasSessionToken ? '••••••••••••••••' : 'Opcional'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Master Emails */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Destinatarios Maestros (uno por línea o separados por coma)
            </label>
            <textarea
              rows={3}
              value={masterEmailsText}
              onChange={(e) => setMasterEmailsText(e.target.value)}
              placeholder="preinscripciones@flacso.edu.uy&#10;direccion@flacso.edu.uy"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              Estos correos recibirán una copia operativa completa (con enlaces a Sheets y Drive) de cada preinscripción de cualquier programa.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar Configuración de Correo'}
            </button>
          </div>
        </form>
      </div>

      {/* Test Email Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-base font-bold text-gray-900 mb-2">Envío de Prueba Amazon SES</h3>
        <p className="text-sm text-gray-600 mb-4">
          Compruebe la autenticación y conectividad con Amazon SES enviando un mensaje directo a una dirección verificada.
        </p>

        {testResult && (
          <div
            className={`mb-4 p-4 rounded-md text-sm ${
              testResult.ok
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {testResult.message}
          </div>
        )}

        <form onSubmit={handleSendTestEmail} className="flex flex-wrap items-center gap-3">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="correo-destino@flacso.edu.uy"
            className="flex-1 min-w-[280px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            disabled={sendingTest || !testEmail}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            {sendingTest ? 'Enviando...' : 'Enviar correo de prueba'}
          </button>
        </form>
      </div>

      {/* Outbox Observability & Queue Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-6">
          <div>
            <h3 className="text-base font-bold text-gray-900">Estado de Notificaciones y Cola Outbox</h3>
            <p className="text-sm text-gray-600">
              Observabilidad de envíos, métricas por estado y reintento manual seguro.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => loadNotifications(statusFilter)}
              disabled={loadingOutbox}
              className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {loadingOutbox ? 'Actualizando...' : '↻ Actualizar'}
            </button>
            <button
              type="button"
              onClick={handleDispatchQueue}
              disabled={dispatching}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              {dispatching ? 'Procesando...' : '⚡ Procesar cola ahora'}
            </button>
          </div>
        </div>

        {dispatchResult && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-md">
            {dispatchResult}
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <div
            onClick={() => handleFilterChange('')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === '' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-gray-500">Total</span>
            <span className="text-xl font-bold text-gray-900">{counts.total}</span>
          </div>
          <div
            onClick={() => handleFilterChange('pending')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === 'pending' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-yellow-700">Pendientes</span>
            <span className="text-xl font-bold text-yellow-800">{counts.pending}</span>
          </div>
          <div
            onClick={() => handleFilterChange('processing')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === 'processing' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-blue-700">En proceso</span>
            <span className="text-xl font-bold text-blue-800">{counts.processing}</span>
          </div>
          <div
            onClick={() => handleFilterChange('sent')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === 'sent' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-green-700">Enviados</span>
            <span className="text-xl font-bold text-green-800">{counts.sent}</span>
          </div>
          <div
            onClick={() => handleFilterChange('failed')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === 'failed' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-red-700">Fallidos</span>
            <span className="text-xl font-bold text-red-800">{counts.failed}</span>
          </div>
          <div
            onClick={() => handleFilterChange('unknown')}
            className={`cursor-pointer p-3 rounded-lg border text-center transition-colors ${
              statusFilter === 'unknown' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className="block text-xs font-medium text-orange-700">Desconocidos</span>
            <span className="text-xl font-bold text-orange-800">{counts.unknown}</span>
          </div>
        </div>

        {/* Notifications Table */}
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Fecha</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Audiencia</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Destinatario</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Oferta</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600">Intentos</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Estado</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Error / Detalle</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {notifications.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                    No se encontraron notificaciones en este estado.
                  </td>
                </tr>
              ) : (
                notifications.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {new Date(item.createdAt).toLocaleString('es-UY', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          item.audience === 'applicant'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : item.audience === 'target'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}
                      >
                        {item.audience === 'applicant'
                          ? 'Postulante'
                          : item.audience === 'target'
                          ? 'Oferta'
                          : 'Copia Maestra'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-900">{item.recipientEmail}</td>
                    <td className="px-3 py-2 text-gray-600">{item.targetId}</td>
                    <td className="px-3 py-2 text-center text-gray-700 font-medium">{item.attemptCount}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          item.status === 'sent'
                            ? 'bg-green-100 text-green-800'
                            : item.status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : item.status === 'unknown'
                            ? 'bg-orange-100 text-orange-800'
                            : item.status === 'processing'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={item.lastError || ''}>
                      {item.lastError || (item.providerMessageId ? `ID: ${item.providerMessageId}` : '-')}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {item.status === 'failed' && (
                        <button
                          type="button"
                          onClick={() => handleRetry(item, false)}
                          disabled={retryingId === item.id}
                          className="px-2 py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          {retryingId === item.id ? 'Reintentando...' : 'Reintentar'}
                        </button>
                      )}
                      {item.status === 'unknown' && (
                        <button
                          type="button"
                          onClick={() => setRetryTarget(item)}
                          className="px-2 py-1 text-xs font-semibold text-orange-600 hover:text-orange-800"
                        >
                          Reintentar...
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal for UNKNOWN status retry */}
      {retryTarget && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-xl border border-gray-200">
            <h4 className="text-base font-bold text-gray-900 mb-2">Confirmar reintento de estado desconocido</h4>
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-xs mb-4 leading-relaxed">
              ⚠️ <strong>Advertencia de duplicado potencial:</strong> La notificación a{' '}
              <span className="font-mono">{retryTarget.recipientEmail}</span> terminó con error ambiguo (tiempo de espera o desconexión). Es posible que Amazon SES ya haya entregado el correo al destinatario. Reintentar forzosamente podría enviar un correo duplicado.
            </div>
            <p className="text-xs text-gray-600 mb-6">
              ¿Desea forzar el reencolado de esta notificación para un nuevo intento?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRetryTarget(null)}
                className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleRetry(retryTarget, true)}
                disabled={retryingId === retryTarget.id}
                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {retryingId === retryTarget.id ? 'Reintentando...' : 'Forzar reintento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
