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
      className="preinscription-loading-screen flex min-h-[28rem] w-full items-center justify-center px-4 py-12 sm:min-h-[34rem]"
      role="status"
      aria-live="polite"
      aria-labelledby="loading-screen-title"
      aria-describedby="loading-screen-message"
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className="w-full max-w-xl rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-lg sm:p-12">
        <div
          className="mx-auto mb-6 h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600"
          aria-hidden="true"
        />
        <h3 id="loading-screen-title" className="text-xl font-bold text-gray-900 mb-3">
          {title}
        </h3>
        <p id="loading-screen-message" className="text-sm text-gray-600 leading-relaxed">
          {message}
        </p>
        <p className="mt-5 text-xs font-medium uppercase tracking-[0.14em] text-blue-700">No cierres esta ventana</p>
      </div>
    </div>
  );
};
