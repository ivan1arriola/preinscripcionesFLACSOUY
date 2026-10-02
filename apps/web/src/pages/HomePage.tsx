import React, { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { TargetList } from '../components/TargetList.js';

interface HomePageProps {
  onSelectTarget: (target: DiagnosticTarget) => void;
}

const ACADEMIC_GROUPS = [
  { key: 'maestria', label: 'Maestrías' },
  { key: 'especializacion', label: 'Especializaciones' },
  { key: 'diplomado', label: 'Diplomados' },
  { key: 'diploma', label: 'Diplomas' },
] as const;

const offerTypeOf = (target: DiagnosticTarget) => target.offerType ?? 'otros';

export const HomePage: React.FC<HomePageProps> = ({ onSelectTarget }) => {
  const [targets, setTargets] = useState<DiagnosticTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiClient
      .listTargets()
      .then((data) => {
        if (mounted) {
          setTargets(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || 'Error al cargar los destinos académicos.');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Cargando destinos académicos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200" role="alert">
        <p className="font-medium">Error de conexión</p>
        <p>{error}</p>
      </div>
    );
  }

  const academicOffers = targets.filter((target) => target.kind === 'academic_offer');
  const seminars = targets.filter((target) => target.kind === 'seminar');

  const renderGroup = (key: string, title: string, groupTargets: DiagnosticTarget[]) => {
    if (groupTargets.length === 0) return null;

    return (
      <details key={key} data-testid={`offer-group-${key}`} className="group rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-gray-900 marker:content-none">
          <span className="flex items-center gap-3">
            <span className="text-gray-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
            {title}
          </span>
          <span className="text-sm font-normal text-gray-500">{groupTargets.length} propuesta{groupTargets.length === 1 ? '' : 's'}</span>
        </summary>
        <div className="space-y-4 border-t border-gray-100 p-4">
          <TargetList targets={groupTargets} onSelectTarget={onSelectTarget} />
        </div>
      </details>
    );
  };

  const renderSection = (title: string, description: string, sectionTargets: DiagnosticTarget[], sectionId: string, groupId: string) => (
    <section aria-labelledby={sectionId} className="space-y-4">
      <div className="border-b border-gray-200 pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id={sectionId} className="text-xl font-bold text-gray-900">{title}</h3>
          <span className="text-sm text-gray-500">{sectionTargets.length} propuesta{sectionTargets.length === 1 ? '' : 's'}</span>
        </div>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>
      <div className="space-y-3">
        {groupId === 'academic'
          ? ACADEMIC_GROUPS.map(({ key, label }) => renderGroup(key, label, sectionTargets.filter((target) => offerTypeOf(target) === key)))
          : renderGroup(groupId, title, sectionTargets)}
        {groupId === 'academic' && renderGroup('otros', 'Otras ofertas académicas', sectionTargets.filter((target) => !ACADEMIC_GROUPS.some(({ key }) => key === offerTypeOf(target))))}
      </div>
    </section>
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Preinscripciones FLACSO Uruguay</h2>
        <p className="text-gray-600 mt-1">
          Seleccione una propuesta académica o seminario para iniciar su preinscripción.
        </p>
      </div>

      <div className="space-y-10">
        {renderSection('Oferta académica', 'Carreras, maestrías, especializaciones, diplomas y diplomados.', academicOffers, 'academic-offers-heading', 'academic')}
        {renderSection('Seminarios', 'Propuestas de formación breve y actualización.', seminars, 'seminars-heading', 'seminarios')}
      </div>
    </div>
  );
};
