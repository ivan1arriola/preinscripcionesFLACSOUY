import React from 'react';

export interface ClosedRegistrationNoticeProps {
  title?: string;
  isConflict?: boolean;
  onBack: () => void;
}

export const ClosedRegistrationNotice: React.FC<ClosedRegistrationNoticeProps> = ({
  title,
  isConflict,
  onBack,
}) => {
  return (
    <div className={`page-notice${isConflict ? ' page-notice--error' : ''}`} role="alert">
      <div>
        {title && <h2>{title}</h2>}
        <p>
          {isConflict
            ? 'La preinscripción para esta propuesta no está disponible por conflicto o inconsistencia en la configuración del catálogo.'
            : 'Las preinscripciones para esta propuesta no se encuentran abiertas en este momento.'}
        </p>
        <button type="button" onClick={onBack} className="btn btn-secondary">
          Ver todas las preinscripciones
        </button>
      </div>
    </div>
  );
};
