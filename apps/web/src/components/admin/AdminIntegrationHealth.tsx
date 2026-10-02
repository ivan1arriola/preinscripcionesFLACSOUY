import React from 'react';

export interface IntegrationStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';
  message?: string;
}

export interface IntegrationsHealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  integrations: {
    wordpress: IntegrationStatus;
    database: IntegrationStatus;
    googleSheets: IntegrationStatus;
    googleDrive: IntegrationStatus;
  };
}

interface Props {
  health: IntegrationsHealthData | null;
  loading: boolean;
  onRefresh: () => void;
}

export const AdminIntegrationHealth: React.FC<Props> = ({ health, loading, onRefresh }) => {
  const getBadge = (status: IntegrationStatus['status']) => {
    switch (status) {
      case 'healthy':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800">Operativo</span>;
      case 'degraded':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">Degradado</span>;
      case 'not_configured':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-700">No Configurado</span>;
      case 'unhealthy':
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800">Inaccesible</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Estado de Integraciones</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
        >
          {loading ? 'Comprobando...' : 'Actualizar estado'}
        </button>
      </div>

      {!health ? (
        <p className="text-sm text-gray-500">Cargando estado...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">Base de Datos</span>
              {getBadge(health.integrations.database.status)}
            </div>
            <p className="text-xs text-gray-500 truncate">{health.integrations.database.message || 'PostgreSQL 3FN'}</p>
          </div>

          <div className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">WordPress REST</span>
              {getBadge(health.integrations.wordpress.status)}
            </div>
            <p className="text-xs text-gray-500 truncate">{health.integrations.wordpress.message || 'Catálogo v1 activo'}</p>
          </div>

          <div className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">Google Sheets</span>
              {getBadge(health.integrations.googleSheets.status)}
            </div>
            <p className="text-xs text-gray-500 truncate">{health.integrations.googleSheets.message || 'Destino de filas'}</p>
          </div>

          <div className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">Google Drive</span>
              {getBadge(health.integrations.googleDrive.status)}
            </div>
            <p className="text-xs text-gray-500 truncate">{health.integrations.googleDrive.message || 'Archivos y carpetas'}</p>
          </div>
        </div>
      )}
    </div>
  );
};
