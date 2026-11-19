import React, { useState } from 'react';
import { apiClient, ApiError } from '../api/client.js';

export const AdminCampaignTrackingCard: React.FC = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    try {
      const { blob, filename } = await apiClient.downloadCampaignTracking(from || undefined, to || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo descargar el archivo. Intente nuevamente.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      <div className="pb-4 border-b border-gray-200 mb-6">
        <h2 className="text-lg font-bold text-gray-900">Seguimiento de campañas</h2>
        <p className="text-xs text-gray-600 mt-1">
          El archivo incluye datos personales (nombre, apellido y correo) junto con la oferta, la edición y los parámetros UTM de cada
          preinscripción. Manéjelo con el cuidado correspondiente y no lo comparta fuera del equipo.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-gray-700">
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm text-gray-700">
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? 'Descargando...' : 'Descargar CSV'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
};
