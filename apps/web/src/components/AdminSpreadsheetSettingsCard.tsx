import React, { useEffect, useState } from 'react';
import { apiClient, ApiError } from '../api/client.js';

interface AdminSpreadsheetSettingsCardProps {
  csrfToken: string;
}

type SpreadsheetTarget = Awaited<ReturnType<typeof apiClient.getAdminSpreadsheets>>['targets'][number];

export const AdminSpreadsheetSettingsCard: React.FC<AdminSpreadsheetSettingsCardProps> = ({ csrfToken }) => {
  const [targets, setTargets] = useState<SpreadsheetTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const load = async (synchronizeMissing = true) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAdminSpreadsheets();
      setTargets(data.targets);
      if (synchronizeMissing && data.targets.some((target) => !target.spreadsheet)) {
        setProvisioning(true);
        const result = await apiClient.provisionAdminSpreadsheets(csrfToken);
        setSummary(result.reconciliation?.status === 'blocked'
          ? 'La aplicación preparó las planillas disponibles. Algunas requieren revisar los permisos de la carpeta en Google Drive.'
          : 'La aplicación preparó automáticamente las planillas de las ofertas disponibles.');
        const refreshed = await apiClient.getAdminSpreadsheets();
        setTargets(refreshed.targets);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear o consultar las planillas automáticamente.');
    } finally {
      setLoading(false);
      setProvisioning(false);
    }
  };

  useEffect(() => { load(); }, []);

  const provision = async () => {
    setProvisioning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await apiClient.provisionAdminSpreadsheets(csrfToken);
      if (res.reconciliation?.status === 'blocked') {
        setError('Algunas planillas no pudieron crearse porque la cuenta de servicio no tiene acceso suficiente a Google Drive. Revisá la carpeta en “Almacenamiento Google Drive”.');
      } else {
        setSummary('Planillas preparadas correctamente.');
      }
      await load(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron sincronizar las planillas automáticamente.');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><span>📊</span> Planillas automáticas por oferta</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Cada oferta y seminario tiene una planilla propia. Se crea automáticamente dentro de la carpeta configurada en Google Drive; no tenés que copiar ni ingresar IDs.
          </p>
        </div>
        <button
          type="button"
          onClick={provision}
          disabled={loading || provisioning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors"
        >
          {provisioning ? 'Preparando planillas...' : 'Reintentar preparación'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {summary && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">{summary}</div>}
      {loading ? (
        <p className="text-sm text-gray-500">Cargando destinos...</p>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {targets.length === 0 ? 'No hay ofertas abiertas que requieran una planilla.' : `${targets.length} destino${targets.length === 1 ? '' : 's'} administrado${targets.length === 1 ? '' : 's'} automáticamente.`}
          </div>
          {targets.map((target) => (
            <div key={target.targetId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{target.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-gray-500">{target.kind === 'seminar' ? 'Seminario' : 'Oferta académica'}</span>
                  {target.spreadsheet?.status === 'blocked' && (
                    <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-medium">Bloqueada</span>
                  )}
                  {target.spreadsheet?.status === 'reconciled' && (
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-medium">Reconciliada</span>
                  )}
                  {target.spreadsheet?.status === 'created' && (
                    <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-medium">Activa</span>
                  )}
                  {target.spreadsheet?.status === 'unchanged' && (
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-medium">Lista</span>
                  )}
                </div>
              </div>
              {target.spreadsheet ? (
                <a
                  href={target.spreadsheet.url ?? `https://docs.google.com/spreadsheets/d/${target.spreadsheet.spreadsheetId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-700 hover:text-blue-900"
                >
                  Abrir planilla ↗
                </a>
              ) : (
                <span className="text-xs text-amber-700">Creación pendiente</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
