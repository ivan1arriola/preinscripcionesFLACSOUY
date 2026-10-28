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
    <div
      className={`rounded-lg border p-6 ${
        isConflict
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
      role="alert"
    >
      {title && <h2 className="text-lg font-bold mb-2">{title}</h2>}
      <p className="font-medium">
        {isConflict
          ? 'La preinscripción para esta propuesta no está disponible por conflicto o inconsistencia en la configuración del catálogo.'
          : 'Las preinscripciones para esta propuesta no se encuentran abiertas en este momento.'}
      </p>
      <button
        type="button"
        onClick={onBack}
        className={`mt-4 text-sm font-medium ${
          isConflict ? 'text-red-700 hover:text-red-800' : 'text-blue-700 hover:text-blue-800'
        } hover:underline`}
      >
        Ver todas las preinscripciones
      </button>
    </div>
  );
};
