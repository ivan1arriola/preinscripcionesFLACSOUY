import React from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';

interface TargetListProps {
  targets: DiagnosticTarget[];
  onSelectTarget: (target: DiagnosticTarget) => void;
}

export const TargetList: React.FC<TargetListProps> = ({ targets, onSelectTarget }) => {
  return (
    <div className="target-list">
      {targets.map((target) => {
        const isOperational = target.status === 'operational';
        const isClosed = target.status === 'closed';
        const isIncompatible = target.status === 'incompatible';

        return (
          <div
            key={target.id}
            data-testid={`target-card-${target.id}`}
            className="target-list-card border rounded-lg p-5 bg-white shadow-sm hover:shadow transition"
          >
            <div className="target-list-card-main flex items-start justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  {target.kind === 'academic_offer' ? 'Oferta Académica' : 'Seminario'}
                </span>
                <h3 className="text-lg font-bold text-gray-900 mt-1">{target.title}</h3>
              </div>

              <div>
                {isOperational && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Abierta
                  </span>
                )}
                {isClosed && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    Cerrada
                  </span>
                )}
                {isIncompatible && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Incompatible
                  </span>
                )}
              </div>
            </div>

            {isIncompatible && (
              <div className="mt-3 p-3 bg-red-50 text-red-700 text-xs rounded border border-red-200">
                <p className="font-semibold">Destino no operativo debido a incompatibilidad:</p>
                <ul className="list-disc list-inside mt-1">
                  {target.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="target-list-card-actions mt-4 flex items-center justify-between">
              {isIncompatible ? (
                <button
                  type="button"
                  disabled
                  className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-500 cursor-not-allowed"
                >
                  Formulario no disponible
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectTarget(target)}
                  className="target-card-primary-action text-sm rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
                >
                  {isOperational ? 'Completar preinscripción' : 'Ver información del destino'}
                </button>
              )}

              {target.urls?.public && (
                <a
                  href={target.urls.public}
                  target="_blank"
                  rel="noreferrer"
                  className="target-card-secondary-action text-sm text-blue-600 hover:underline"
                >
                  Ver programa en web &rarr;
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
