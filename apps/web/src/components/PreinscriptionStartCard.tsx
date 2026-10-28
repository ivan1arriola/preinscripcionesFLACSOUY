import React from 'react';

export interface PreinscriptionDocumentSummaryItem {
  label: string;
  required: boolean;
}

export interface PreinscriptionStartCardProps {
  title: string;
  documentSummary: PreinscriptionDocumentSummaryItem[];
  sectionCount: number;
  onStart: () => void;
  disabled: boolean;
}

export const PreinscriptionStartCard: React.FC<PreinscriptionStartCardProps> = ({
  title,
  documentSummary,
  sectionCount,
  onStart,
  disabled,
}) => (
  <section className="preinscription-start-card start-card" aria-labelledby="preinscription-start-title">
    {/* La página ya muestra el título de la propuesta arriba; aquí queda para lectores de pantalla. */}
    <p className="start-card__eyebrow">{title}</p>
    <h1 id="preinscription-start-title">Antes de comenzar</h1>
    <p className="start-card__lead">
      Completá tu preinscripción paso a paso. Vas a necesitar unos minutos y los documentos indicados a continuación.
    </p>

    <div className="start-card__meta" aria-label="Información de la preinscripción">
      <div className="start-card__meta-item">
        <span className="start-card__meta-icon" aria-hidden="true">{sectionCount}</span>
        <div>
          <span className="start-card__meta-label">Secciones</span>
          <strong className="start-card__meta-value">{sectionCount} secciones</strong>
        </div>
      </div>
      <div className="start-card__meta-item">
        <span className="start-card__meta-icon" aria-hidden="true">⏱</span>
        <div>
          <span className="start-card__meta-label">Tiempo estimado</span>
          <strong className="start-card__meta-value">10–15 minutos</strong>
        </div>
      </div>
    </div>

    <div className="start-card__docs">
      <h2>Documentos que podés preparar</h2>
      {documentSummary.length > 0 ? (
        <ul className="start-card__doc-list">
          {documentSummary.map((document) => (
            <li key={document.label} className="start-card__doc">
              <span>{document.label}</span>
              <span className={`start-card__doc-tag${document.required ? ' start-card__doc-tag--required' : ''}`}>
                {document.required ? 'obligatorio' : 'opcional'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="start-card__empty">Esta propuesta no requiere documentos adjuntos.</p>
      )}
    </div>

    <button
      type="button"
      className="wizard-primary-action btn btn-accent btn-large btn-block"
      onClick={onStart}
      disabled={disabled}
    >
      Comenzar preinscripción
    </button>
  </section>
);
