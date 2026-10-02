import React, { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from '../api/client.js';
import { TargetList } from '../components/TargetList.js';

interface HomePageProps {
  onSelectTarget: (id: string) => void;
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

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Preinscripciones FLACSO Uruguay</h2>
        <p className="text-gray-600 mt-1">
          Seleccione una propuesta académica o seminario para iniciar su preinscripción.
        </p>
      </div>

      <TargetList targets={targets} onSelectTarget={onSelectTarget} />
    </div>
  );
};
