import React from 'react';

export interface SystemErrorItem {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  origin: 'wordpress' | 'sheets' | 'drive' | 'database' | 'system';
  code: string;
  message: string;
  context: Record<string, unknown>;
  targetId?: string;
  status: 'unresolved' | 'resolved';
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
}

interface Props {
  errors: SystemErrorItem[];
  loading: boolean;
  onResolve: (errorId: string) => void;
  resolvingId: string | null;
}

export const AdminErrorList: React.FC<Props> = ({ errors, loading, onResolve, resolvingId }) => {
  const getSeverityBadge = (severity: SystemErrorItem['severity']) => {
    switch (severity) {
      case 'critical':
        return <span className="px-2 py-0.5 text-xs font-bold rounded bg-red-600 text-white">Crítico</span>;
      case 'high':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800">Alto</span>;
      case 'medium':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">Medio</span>;
      case 'low':
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 text-blue-800">Bajo</span>;
    }
  };

  const getOriginBadge = (origin: SystemErrorItem['origin']) => {
    return <span className="text-xs font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{origin}</span>;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Errores Técnicos del Sistema</h2>
          <p className="text-xs text-gray-500">Trazabilidad de fallos sin filtración de datos sensibles o secretos</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando errores...</p>
      ) : errors.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm bg-gray-50 rounded border border-dashed">
          No hay errores registrados en el sistema. Todos los servicios funcionan sin incidencias.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase border-b">
              <tr>
                <th className="py-2.5 px-3">Severidad</th>
                <th className="py-2.5 px-3">Origen / Código</th>
                <th className="py-2.5 px-3">Mensaje</th>
                <th className="py-2.5 px-3">Destino / Contexto</th>
                <th className="py-2.5 px-3">Fecha</th>
                <th className="py-2.5 px-3 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {errors.map((err) => (
                <tr key={err.id} className={err.status === 'resolved' ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {getSeverityBadge(err.severity)}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <div className="flex items-center space-x-1.5">
                      {getOriginBadge(err.origin)}
                    </div>
                    <div className="font-mono text-gray-500 text-[11px] mt-0.5">{err.code}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <p className="font-medium text-gray-900">{err.message}</p>
                  </td>
                  <td className="py-2.5 px-3">
                    {err.targetId && (
                      <span className="inline-block text-[11px] font-mono bg-blue-50 text-blue-700 px-1 rounded mb-1">
                        {err.targetId}
                      </span>
                    )}
                    {Object.keys(err.context || {}).length > 0 && (
                      <pre className="text-[10px] text-gray-500 bg-gray-100 p-1 rounded max-w-xs overflow-x-auto">
                        {JSON.stringify(err.context, null, 1)}
                      </pre>
                    )}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-gray-500 text-[11px]">
                    {new Date(err.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-right">
                    {err.status === 'resolved' ? (
                      <span className="text-green-700 font-medium text-xs">
                        ✓ Resuelto ({err.resolvedBy})
                      </span>
                    ) : (
                      <button
                        onClick={() => onResolve(err.id)}
                        disabled={resolvingId === err.id}
                        className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs disabled:opacity-50"
                      >
                        {resolvingId === err.id ? 'Resolviendo...' : 'Resolver'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
