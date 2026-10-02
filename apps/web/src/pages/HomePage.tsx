import React, { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { TargetList } from '../components/TargetList.js';

interface HomePageProps {
  onSelectTarget: (target: DiagnosticTarget) => void;
}

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

  const renderSection = (title: string, description: string, sectionTargets: DiagnosticTarget[], sectionId: string) => (
    <section aria-labelledby={sectionId} className="space-y-4">
      <div className="border-b border-gray-200 pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id={sectionId} className="text-xl font-bold text-gray-900">{title}</h3>
          <span className="text-sm text-gray-500">{sectionTargets.length} propuesta{sectionTargets.length === 1 ? '' : 's'}</span>
        </div>
        <p className="text-sm text-gray-600 mt-1">{description}</p>
      </div>
      {sectionTargets.length > 0 ? <TargetList targets={sectionTargets} onSelectTarget={onSelectTarget} /> : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          No hay propuestas disponibles en esta categoría.
        </div>
      )}
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
        {renderSection('Oferta académica', 'Carreras, maestrías, especializaciones, diplomas y diplomados.', academicOffers, 'academic-offers-heading')}
        {renderSection('Seminarios', 'Propuestas de formación breve y actualización.', seminars, 'seminars-heading')}
      </div>
    </div>
  );
};
