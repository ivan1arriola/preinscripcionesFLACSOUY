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

const groupTargetsByPermalink = (items: DiagnosticTarget[]): DiagnosticTarget[] => {
  const groups = new Map<string, DiagnosticTarget[]>();
  for (const item of items) {
    const permalink = legacyPathForTarget(item) ?? item.id;
    const list = groups.get(permalink) ?? [];
    list.push(item);
    groups.set(permalink, list);
  }

  const representativeTargets: DiagnosticTarget[] = [];
  for (const editions of groups.values()) {
    if (editions.length === 1 && editions[0]) {
      representativeTargets.push(editions[0]);
      continue;
    }

    const hasConflict = editions.some(
      (e) =>
        e.registrationAvailability === 'conflict' ||
        e.issues.includes('multiple_open_seminar_editions') ||
        e.issues.includes('multiple_open_cohorts') ||
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
      const conflictIssue = base.kind === 'seminar' ? 'multiple_open_seminar_editions' : 'multiple_open_cohorts';
      representativeTargets.push({
        ...base,
        registrationOpen: false,
        registrationAvailability: 'conflict',
        status: 'incompatible',
        issues: [conflictIssue],
      });
    } else if (openEditions.length === 1 && openEditions[0]) {
      representativeTargets.push(openEditions[0]);
    } else {
      const base = editions[editions.length - 1] ?? editions[0]!;
      representativeTargets.push({
        ...base,
        registrationOpen: false,
        registrationAvailability: 'closed',
        status: 'closed',
      });
    }
  }

  return representativeTargets;
};

export const HomePage: React.FC<HomePageProps> = ({ onSelectTarget }) => {
  const [targets, setTargets] = useState<DiagnosticTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'academic' | 'seminars'>('academic');
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
      <div className="home-state home-state-loading" role="status" aria-live="polite">
        <span className="home-state-icon" aria-hidden="true" />
        <div>
          <strong>Estamos preparando la oferta</strong>
          <p>Un momento, por favor. Enseguida vas a poder elegir tu propuesta.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-state home-state-error" role="alert">
        <span className="home-state-icon" aria-hidden="true">!</span>
        <div>
          <strong>No pudimos cargar la oferta</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const rawAcademicOffers = targets.filter((target) => target.kind === 'academic_offer');
  const academicOffers = groupTargetsByPermalink(rawAcademicOffers);
  const rawSeminars = targets.filter((target) => target.kind === 'seminar');
  const seminars = groupTargetsByPermalink(rawSeminars);
  const normalizedQuery = query.trim().toLocaleLowerCase('es-UY');
  const matchesQuery = (target: DiagnosticTarget) =>
    !normalizedQuery || target.title.toLocaleLowerCase('es-UY').includes(normalizedQuery);
  const visibleAcademicOffers = academicOffers.filter(matchesQuery);
  const visibleSeminars = seminars.filter(matchesQuery);
  const availableCount = [...academicOffers, ...seminars].filter((target) => target.status === 'operational').length;

  const selectTab = (tab: 'academic' | 'seminars') => {
    setActiveTab(tab);
    setQuery('');
    setOpenGroup(null);
  };

  const renderGroup = (key: string, title: string, groupTargets: DiagnosticTarget[]) => {
    if (groupTargets.length === 0) return null;

    return (
      <details
        key={key}
        open={openGroup === key}
        data-testid={`offer-group-${key}`}
        className="catalog-group group rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <summary
          className="catalog-group-summary flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-gray-900 marker:content-none"
          onClick={(event) => {
            event.preventDefault();
            setOpenGroup((current) => (current === key ? null : key));
          }}
        >
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
      <div className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Formación FLACSO Uruguay</span>
          <h2>Elegí tu próxima propuesta de formación</h2>
          <p>
            Explorá la oferta académica y los seminarios disponibles. Cuando encuentres una propuesta,
            podés comenzar tu preinscripción en pocos pasos.
          </p>
        </div>
        <div className="home-hero-summary" aria-label={`${availableCount} ${availableCount === 1 ? 'propuesta disponible' : 'propuestas disponibles'}`}>
          <span className="home-hero-summary-value">{availableCount}</span>
          <span className="home-hero-summary-label">{availableCount === 1 ? 'propuesta disponible' : 'propuestas disponibles'}</span>
        </div>
      </div>

      <div className="catalog-controls">
        <div className="catalog-tabs" role="tablist" aria-label="Tipo de propuesta">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'academic'}
            className={activeTab === 'academic' ? 'catalog-tab catalog-tab-active' : 'catalog-tab'}
            onClick={() => selectTab('academic')}
          >
            Oferta académica <span>{academicOffers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'seminars'}
            className={activeTab === 'seminars' ? 'catalog-tab catalog-tab-active' : 'catalog-tab'}
            onClick={() => selectTab('seminars')}
          >
            Seminarios <span>{seminars.length}</span>
          </button>
        </div>
        <label className="catalog-search">
          <span className="sr-only">Buscar propuesta</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpenGroup(null);
            }}
            placeholder={activeTab === 'academic' ? 'Buscar una propuesta académica' : 'Buscar un seminario'}
            aria-label="Buscar propuesta"
          />
        </label>
      </div>

      <div className="catalog-panel" role="region" aria-label="Catálogo de propuestas">
        <div role="tabpanel" aria-label={activeTab === 'academic' ? 'Oferta académica' : 'Seminarios'}>
          {activeTab === 'academic'
            ? renderSection('Oferta académica', 'Carreras, maestrías, especializaciones, diplomas y diplomados.', visibleAcademicOffers, 'academic-offers-heading', 'academic')
            : renderSection('Seminarios', 'Propuestas de formación breve y actualización.', visibleSeminars, 'seminars-heading', 'seminarios')}
          {(activeTab === 'academic' ? visibleAcademicOffers : visibleSeminars).length === 0 && (
            <p className="catalog-empty">No encontramos propuestas para esa búsqueda.</p>
          )}
        </div>
      </div>
    </div>
  );
};
