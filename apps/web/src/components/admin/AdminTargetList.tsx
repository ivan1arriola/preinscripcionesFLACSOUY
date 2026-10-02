import React from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';

interface Props {
  targets: DiagnosticTarget[];
  loading: boolean;
  onDiagnose: (targetId: string) => void;
  onViewForm?: (targetId: string) => void;
}

export const AdminTargetList: React.FC<Props> = ({ targets, loading, onDiagnose, onViewForm }) => {
  const getStatusBadge = (status: DiagnosticTarget['status']) => {
    switch (status) {
      case 'operational':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800">Operativo</span>;
      case 'closed':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-800">Cerrado</span>;
      case 'incompatible':
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-800">Incompatible</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Formularios Detectados</h2>
          <p className="text-xs text-gray-500">Ofertas académicas y seminarios sincronizados desde WordPress</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando destinos...</p>
      ) : targets.length === 0 ? (
        <p className="text-sm text-gray-500">No se detectaron destinos configurados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600 uppercase border-b">
              <tr>
                <th className="py-2.5 px-3">Título / ID</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3">Revisión</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {targets.map((target) => (
                <tr key={target.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-gray-900">{target.title}</div>
                    <div className="text-gray-400 font-mono text-[11px]">{target.id}</div>
                  </td>
                  <td className="py-2.5 px-3 text-gray-600">
                    {target.kind === 'seminar' ? 'Seminario' : 'Oferta Académica'}
                  </td>
                  <td className="py-2.5 px-3 text-gray-600 font-mono">
                    {target.configRevision}
                  </td>
                  <td className="py-2.5 px-3">
                    {getStatusBadge(target.status)}
                  </td>
                  <td className="py-2.5 px-3 text-right space-x-2">
                    {onViewForm && (
                      <button
                        onClick={() => onViewForm(target.id)}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Ver Formulario
                      </button>
                    )}
                    <button
                      onClick={() => onDiagnose(target.id)}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded text-xs"
                    >
                      Diagnosticar
                    </button>
                    {target.urls?.wordpress && (
                      <a
                        href={target.urls.wordpress}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gray-400 hover:text-gray-600 text-xs"
                        title="Ver en WordPress"
                      >
                        WP ↗
                      </a>
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
