import React, { useEffect, useRef } from 'react';

export interface PreinscriptionLoadingOverlayProps {
  title?: string;
  message?: string;
}

export const PreinscriptionLoadingOverlay: React.FC<PreinscriptionLoadingOverlayProps> = ({
  title = 'Enviando tu preinscripción…',
  message = 'Guardando tus datos y documentación en FLACSO Uruguay. Por favor aguardá unos instantes.',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="preinscription-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby="loading-overlay-title"
      aria-describedby="loading-overlay-message"
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 text-center border border-slate-100 flex flex-col items-center">
        <div
          className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"
          aria-hidden="true"
        />
        <h3 id="loading-overlay-title" className="text-xl font-bold text-gray-900 mb-2">
          {title}
        </h3>
        <p id="loading-overlay-message" className="text-sm text-gray-600 leading-relaxed">
          {message}
        </p>
      </div>
    </div>
  );
};
