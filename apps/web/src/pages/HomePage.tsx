import React, { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { TargetList } from '../components/TargetList.js';

import { legacyPathForTarget } from '../domain/legacy-permalink-resolution.js';

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

const groupSeminarsByPermalink = (seminarTargets: DiagnosticTarget[]): DiagnosticTarget[] => {
  const groups = new Map<string, DiagnosticTarget[]>();
  for (const sem of seminarTargets) {
    const permalink = legacyPathForTarget(sem) ?? sem.id;
    const list = groups.get(permalink) ?? [];
    list.push(sem);
    groups.set(permalink, list);
  }

  const representativeSeminars: DiagnosticTarget[] = [];
  for (const editions of groups.values()) {
    if (editions.length === 1 && editions[0]) {
      representativeSeminars.push(editions[0]);
      continue;
    }

    const hasConflict = editions.some(
      (e) =>
        e.registrationAvailability === 'conflict' ||
        e.issues.includes('multiple_open_seminar_editions') ||
        e.issues.includes('inconsistent_seminar_permalink')
    );

    const openEditions = editions.filter((e) => {
      if (e.registrationAvailability !== undefined) {
        return e.registrationAvailability === 'open';
      }
      return Boolean(e.registrationOpen && e.status === 'operational');
    });

    if (hasConflict || openEditions.length > 1) {
      const base = editions[0]!;
      representativeSeminars.push({
        ...base,
        registrationOpen: false,
        registrationAvailability: 'conflict',
        status: 'incompatible',
        issues: ['multiple_open_seminar_editions'],
      });
    } else if (openEditions.length === 1 && openEditions[0]) {
      representativeSeminars.push(openEditions[0]);
    } else {
      const base = editions[0]!;
      representativeSeminars.push({
        ...base,
        registrationOpen: false,
        registrationAvailability: 'closed',
        status: 'closed',
      });
    }
  }

  return representativeSeminars;
};

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
  const rawSeminars = targets.filter((target) => target.kind === 'seminar');
  const seminars = groupSeminarsByPermalink(rawSeminars);

  const renderGroup = (key: string, title: string, groupTargets: DiagnosticTarget[]) => {
    if (groupTargets.length === 0) return null;

    return (
      <details key={key} data-testid={`offer-group-${key}`} className="catalog-group group rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary className="catalog-group-summary flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-gray-900 marker:content-none">
          <span className="flex items-center gap-3">
            <span className="catalog-group-chevron text-gray-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
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
    <section aria-labelledby={sectionId} className="catalog-section space-y-4">
      <div className="catalog-section-heading border-b border-gray-200 pb-3">
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
    <div className="home-page">
      <div className="home-hero mb-6">
        <span className="home-eyebrow">Formación FLACSO Uruguay</span>
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
