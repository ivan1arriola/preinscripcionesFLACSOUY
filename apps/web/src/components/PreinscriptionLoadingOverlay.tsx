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
      className="preinscription-loading-screen loading-screen"
      role="status"
      aria-live="polite"
      aria-labelledby="loading-screen-title"
      aria-describedby="loading-screen-message"
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className="loading-card loading-card--brand">
        <p className="loading-card__slogan">
          Formación que <em>conecta</em>, conocimiento que <em>transforma</em>.
        </p>
        <div className="loading-spinner" aria-hidden="true" />
        <h3 id="loading-screen-title">{title}</h3>
        <p id="loading-screen-message">{message}</p>
        <p className="loading-card__warn">No cierres esta ventana</p>
      </div>
    </div>
  );
};
