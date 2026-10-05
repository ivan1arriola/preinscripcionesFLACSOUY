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
  <section className="preinscription-start-card form-step-card bg-white shadow rounded-lg p-6" aria-labelledby="preinscription-start-title">
    <div className="space-y-3">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{title}</p>
      <h1 id="preinscription-start-title" className="text-2xl font-bold text-gray-900">Antes de comenzar</h1>
      <p className="text-base leading-7 text-gray-700">
        Completá tu preinscripción paso a paso. Vas a necesitar unos minutos y los documentos indicados a continuación.
      </p>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Información de la preinscripción">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <span className="block text-sm text-blue-800">Secciones</span>
        <strong className="mt-1 block text-lg text-blue-950">{sectionCount} secciones</strong>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <span className="block text-sm text-gray-600">Tiempo estimado</span>
        <strong className="mt-1 block text-lg text-gray-900">10–15 minutos</strong>
      </div>
    </div>

    <div className="mt-6">
      <h2 className="text-base font-semibold text-gray-900">Documentos que podés preparar</h2>
      {documentSummary.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          {documentSummary.map((document) => (
            <li key={document.label} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 text-blue-700">●</span>
              <span>
                {document.label}{' '}
                <span className="text-gray-500">({document.required ? 'obligatorio' : 'opcional'})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-600">Esta propuesta no requiere documentos adjuntos.</p>
      )}
    </div>

    <button
      type="button"
      className="wizard-primary-action mt-7 min-h-11 w-full rounded-md bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onStart}
      disabled={disabled}
    >
      Comenzar preinscripción
    </button>
  </section>
);
