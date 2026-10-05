import React, { useState, useEffect } from 'react';
import {
  apiClient,
  ApiError,
  type AdminRecoveryRecord,
  type AdminRecoveryDetail,
} from '../api/client.js';

interface AdminFailedSubmissionsCardProps {
  csrfToken: string;
}

export const AdminFailedSubmissionsCard: React.FC<AdminFailedSubmissionsCardProps> = ({
  csrfToken,
}) => {
  const [recoveries, setRecoveries] = useState<AdminRecoveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('failed,retrying');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Selected item for detail modal
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminRecoveryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Item to discard
  const [discardTargetId, setDiscardTargetId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState<string>('');
  const [discarding, setDiscarding] = useState(false);

  // Retrying state
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadRecoveries = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.listRecoveries({
        status: statusFilter || undefined,
        stage: stageFilter || undefined,
        search: searchTerm.trim() || undefined,
      });
      setRecoveries(res.recoveries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al cargar las preinscripciones para recuperación');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecoveries();
  }, [statusFilter, stageFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadRecoveries();
  };

  const openDetail = async (id: string) => {
    setSelectedRecoveryId(id);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await apiClient.getRecovery(id);
      setDetail(res.recovery);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al obtener el detalle de la preinscripción');
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => {
    setSelectedRecoveryId(null);
    setDetail(null);
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    setError(null);
    setActionSuccess(null);
    try {
      const res = await apiClient.retryRecovery(id, csrfToken);
      setActionSuccess(`Preinscripción reintentada con éxito: ${res.message}`);
      await loadRecoveries();
      if (selectedRecoveryId === id) {
        await openDetail(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al reintentar la preinscripción');
    } finally {
      setRetryingId(null);
    }
  };

  const confirmDiscard = async () => {
    if (!discardTargetId) return;
    setDiscarding(true);
    setError(null);
    setActionSuccess(null);
    try {
      const res = await apiClient.discardRecovery(discardTargetId, csrfToken, discardReason.trim() || undefined);
      setActionSuccess(res.message);
      setDiscardTargetId(null);
      setDiscardReason('');
      if (selectedRecoveryId === discardTargetId) {
        closeDetail();
      }
      await loadRecoveries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al descartar el incidente de preinscripción');
    } finally {
      setDiscarding(false);
    }
  };

  const formatStage = (stage: string) => {
    switch (stage) {
      case 'drive':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800">Google Drive</span>;
      case 'sheets':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800">Google Sheets</span>;
      case 'notifications':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">Notificaciones</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-800">{stage}</span>;
    }
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'failed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">● Pendiente</span>;
      case 'retrying':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-100 text-yellow-800">● Reintentando</span>;
      case 'resolved':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">✓ Resuelto</span>;
      case 'discarded':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700">✕ Descartado</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const formatExpiration = (expiresAt: string) => {
    const exp = new Date(expiresAt);
    const now = new Date();
    const diffMs = exp.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    if (diffMs <= 0) {
      return <span className="text-red-600 font-semibold">Expirado ({exp.toLocaleDateString()})</span>;
    }
    if (diffHours < 24) {
      return <span className="text-amber-600 font-medium">En {diffHours} horas</span>;
    }
    const days = Math.round(diffHours / 24);
    return <span className="text-gray-600">En {days} días ({exp.toLocaleDateString()})</span>;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-200 mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>🛡️</span> Bandeja de Recuperación de Preinscripciones
          </h2>
          <p className="text-xs text-gray-600 mt-1">
            Gestión y reintento de preinscripciones con fallos técnicos en Google Drive o Sheets. Los archivos temporales se conservan 7 días para permitir su recuperación.
          </p>
        </div>

        <button
          type="button"
          onClick={loadRecoveries}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded-md text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          ↻ Actualizar lista
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {actionSuccess && (
        <div className="mb-4 p-3 rounded-md bg-green-50 border border-green-200 text-green-800 text-xs">
          {actionSuccess}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 mb-6 text-xs">
        <div className="flex items-center gap-1.5">
          <label className="font-semibold text-gray-600">Estado:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-1.5 border border-gray-300 rounded bg-white text-xs focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="failed,retrying">Pendientes y en proceso</option>
            <option value="failed">Solo pendientes</option>
            <option value="retrying">Solo en reintento</option>
            <option value="resolved">Resueltos</option>
            <option value="discarded">Descartados</option>
            <option value="">Todos los estados</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="font-semibold text-gray-600">Etapa:</label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="p-1.5 border border-gray-300 rounded bg-white text-xs focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Todas las etapas</option>
            <option value="drive">Google Drive</option>
            <option value="sheets">Google Sheets</option>
            <option value="notifications">Notificaciones</option>
          </select>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2 min-w-[200px]">
          <input
            type="text"
            placeholder="Buscar por ID de seguimiento, oferta o error..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 p-1.5 border border-gray-300 rounded bg-white text-xs focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-2.5 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
          >
            Buscar
          </button>
        </form>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-10 text-gray-500 text-xs">
          Cargando casos de recuperación...
        </div>
      ) : recoveries.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm font-semibold text-gray-700">No hay preinscripciones pendientes de recuperación</p>
          <p className="text-xs text-gray-500 mt-1">
            Todos los envíos se han completado correctamente o no coinciden con los filtros aplicados.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
              <tr>
                <th className="py-2.5 px-3">Seguimiento</th>
                <th className="py-2.5 px-3">Oferta académica</th>
                <th className="py-2.5 px-3">Etapa</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3">Docs</th>
                <th className="py-2.5 px-3">Detalle del error</th>
                <th className="py-2.5 px-3">Retención</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recoveries.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-3 font-mono text-[11px] font-semibold text-gray-900">
                    {item.submissionId}
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-gray-900 line-clamp-1">
                      {item.targetTitle ?? item.targetId}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">{item.targetId}</div>
                  </td>
                  <td className="py-3 px-3">{formatStage(item.stage)}</td>
                  <td className="py-3 px-3">{formatStatus(item.status)}</td>
                  <td className="py-3 px-3">
                    <span className="font-mono text-gray-700">{item.filesCount}</span>
                  </td>
                  <td className="py-3 px-3 max-w-xs">
                    <p className="text-red-700 text-[11px] truncate font-mono" title={item.safeError}>
                      {item.safeError}
                    </p>
                    <span className="text-[10px] text-gray-400">
                      Intentos: {item.attemptCount} • {new Date(item.lastAttemptAt).toLocaleTimeString()}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-[11px]">
                    {formatExpiration(item.retentionExpiresAt)}
                  </td>
                  <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openDetail(item.id)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 bg-white hover:bg-gray-50 font-medium"
                    >
                      Detalle
                    </button>
                    {item.status !== 'resolved' && item.status !== 'discarded' && (
                      <>
                        <button
                          type="button"
                          disabled={retryingId === item.id}
                          onClick={() => handleRetry(item.id)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium disabled:opacity-50"
                        >
                          {retryingId === item.id ? 'Reintentando...' : 'Reintentar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscardTargetId(item.id)}
                          className="px-2 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 font-medium"
                        >
                          Descartar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Drawer / Modal */}
      {selectedRecoveryId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>📋</span> Detalle de Incidente: <span className="font-mono text-blue-600">{detail?.submissionId ?? selectedRecoveryId}</span>
              </h3>
              <button
                type="button"
                onClick={closeDetail}
                className="text-gray-400 hover:text-gray-600 text-base"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {loadingDetail ? (
                <div className="text-center py-10 text-gray-500">Cargando detalle del incidente...</div>
              ) : !detail ? (
                <div className="text-red-600">No se pudo cargar la información del incidente.</div>
              ) : (
                <>
                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div>
                      <span className="text-gray-500 block">Oferta académica:</span>
                      <span className="font-semibold text-gray-900">{detail.targetTitle ?? detail.targetId}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Etapa fallida:</span>
                      <span className="mt-0.5 inline-block">{formatStage(detail.stage)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Estado actual:</span>
                      <span className="mt-0.5 inline-block">{formatStatus(detail.status)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Retención hasta:</span>
                      <span className="font-medium text-gray-900">
                        {new Date(detail.retentionExpiresAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Error Box */}
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1">
                    <span className="font-semibold text-red-900 block">Detalle técnico del error:</span>
                    <p className="font-mono text-[11px] text-red-700 whitespace-pre-wrap">{detail.safeError}</p>
                  </div>

                  {/* Document Status */}
                  <div className="space-y-2">
                    <h4 className="font-semibold text-gray-800 flex items-center justify-between">
                      <span>Documentos adjuntos ({detail.files.length})</span>
                      <span className="text-[11px] text-gray-500 font-normal">
                        Conservados durante 7 días en almacenamiento privado
                      </span>
                    </h4>

                    {detail.files.length === 0 ? (
                      <p className="text-gray-500 italic">No se adjuntaron documentos en esta preinscripción.</p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                        {detail.files.map((file, idx) => (
                          <div key={idx} className="p-3 flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium text-gray-900">{file.originalName}</div>
                              <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                                Campo: {file.fieldKey} • {(file.sizeBytes / 1024).toFixed(1)} KB
                              </div>
                            </div>

                            <div className="text-right">
                              {file.status === 'stored_in_drive' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-800">
                                  ✓ Confirmado en Drive
                                </span>
                              ) : file.status === 'pending_in_storage' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800">
                                  ● En almacenamiento temporal
                                </span>
                              ) : (
                                <div className="text-right">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-800">
                                    ✗ Archivo vencido / no disponible
                                  </span>
                                  <p className="text-[10px] text-red-600 mt-0.5">
                                    El archivo temporal expiró; el postulante debe reenviarlo.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={closeDetail}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded-md text-xs font-medium hover:bg-gray-100"
              >
                Cerrar
              </button>

              {detail && detail.status !== 'resolved' && detail.status !== 'discarded' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDiscardTargetId(detail.id)}
                    className="px-3 py-1.5 border border-red-300 text-red-700 bg-white rounded-md text-xs font-medium hover:bg-red-50"
                  >
                    Descartar incidente
                  </button>
                  <button
                    type="button"
                    disabled={retryingId === detail.id}
                    onClick={() => handleRetry(detail.id)}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {retryingId === detail.id ? 'Reintentando...' : 'Reintentar procesamiento ahora'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Discard Confirmation Modal */}
      {discardTargetId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <span className="text-xl">⚠️</span>
              <h3 className="text-sm font-bold text-gray-900">¿Descartar incidente de preinscripción?</h3>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Esta acción marcará el caso como descartado y <strong className="text-red-700">eliminará de forma definitiva los archivos temporales</strong> del almacenamiento. Esta operación no se puede deshacer.
            </p>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-700">
                Motivo del descarte (opcional):
              </label>
              <textarea
                rows={2}
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                placeholder="Ej: Postulante duplicado, o canceló la preinscripción..."
                className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={discarding}
                onClick={() => {
                  setDiscardTargetId(null);
                  setDiscardReason('');
                }}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 bg-white rounded-md text-xs font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={discarding}
                onClick={confirmDiscard}
                className="px-4 py-1.5 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {discarding ? 'Descartando...' : 'Confirmar descarte definitivo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

