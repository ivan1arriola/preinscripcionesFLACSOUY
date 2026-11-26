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
            className="target-list-card"
          >
            <div className="target-list-card-main">
              <div>
                <span className="target-list-card-kind">
                  {target.kind === 'academic_offer' ? 'Oferta Académica' : 'Seminario'}
                </span>
                <h3>{target.title}</h3>
              </div>

              <div className="target-list-card-status">
                {isOperational && (
                  <span className="target-status target-status-open">
                    Abierta
                  </span>
                )}
                {isClosed && (
                  <span className="target-status target-status-closed">
                    Cerrada
                  </span>
                )}
                {isIncompatible && (
                  <span className="target-status target-status-incompatible">
                    Incompatible
                  </span>
                )}
              </div>
            </div>

            {isIncompatible && (
              <div className="target-list-card-warning">
                <p className="font-semibold">Destino no operativo debido a incompatibilidad:</p>
                <ul className="list-disc list-inside mt-1">
                  {target.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="target-list-card-actions">
              {isIncompatible ? (
                <button
                  type="button"
                  disabled
                  className="target-card-disabled"
                >
                  Formulario no disponible
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectTarget(target)}
                  className={`btn ${isOperational ? 'btn-primary' : 'btn-secondary'} target-card-primary-action`}
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
