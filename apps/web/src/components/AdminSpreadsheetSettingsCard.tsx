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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAdminSpreadsheets();
      setTargets(data.targets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la configuración de planillas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const provision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      await apiClient.provisionAdminSpreadsheets(csrfToken);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron crear las planillas automáticamente.');
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><span>📊</span> Planillas por oferta</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            La aplicación crea una planilla independiente para cada oferta y seminario. No tenés que copiar ni ingresar IDs.
          </p>
        </div>
        <button
          type="button"
          onClick={provision}
          disabled={loading || provisioning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors"
        >
          {provisioning ? 'Creando planillas...' : 'Crear planillas faltantes'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {loading ? (
        <p className="text-sm text-gray-500">Cargando destinos...</p>
      ) : (
        <div className="space-y-2">
          {targets.map((target) => (
            <div key={target.targetId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{target.title}</p>
                <p className="text-[11px] text-gray-500">{target.kind === 'seminar' ? 'Seminario' : 'Oferta académica'}</p>
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
                <span className="text-xs text-amber-700">Pendiente de creación</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
