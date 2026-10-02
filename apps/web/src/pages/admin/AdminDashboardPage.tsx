import React, { useState, useEffect } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from '../../api/client';
import { AdminIntegrationHealth, type IntegrationsHealthData } from '../../components/admin/AdminIntegrationHealth';
import { AdminTargetList } from '../../components/admin/AdminTargetList';
import { AdminDiagnosticsModal, type TargetDeepDiagnostic } from '../../components/admin/AdminDiagnosticsModal';
import { AdminErrorList, type SystemErrorItem } from '../../components/admin/AdminErrorList';

interface Props {
  onLogout: () => void;
  onSelectTarget?: (targetId: string) => void;
}

export const AdminDashboardPage: React.FC<Props> = ({ onLogout, onSelectTarget }) => {
  const [health, setHealth] = useState<IntegrationsHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [targets, setTargets] = useState<DiagnosticTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  const [errors, setErrors] = useState<SystemErrorItem[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [selectedTargetDiagnostic, setSelectedTargetDiagnostic] = useState<TargetDeepDiagnostic | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const data = await apiClient.getAdminHealth();
      setHealth(data);
    } catch {
      // Ignored or handled
    } finally {
      setHealthLoading(false);
    }
  };

  const loadTargets = async () => {
    setTargetsLoading(true);
    try {
      const data = await apiClient.getAdminTargets();
      setTargets(data);
    } catch {
      // Ignored
    } finally {
      setTargetsLoading(false);
    }
  };

  const loadErrors = async () => {
    setErrorsLoading(true);
    try {
      const data = await apiClient.getAdminErrors();
      setErrors(data);
    } catch {
      // Ignored
    } finally {
      setErrorsLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
    loadTargets();
    loadErrors();
  }, []);

  const handleDiagnose = async (targetId: string) => {
    setIsModalOpen(true);
    setDiagnosticLoading(true);
    try {
      const diag = await apiClient.getAdminTargetDiagnostics(targetId);
      setSelectedTargetDiagnostic(diag);
    } catch {
      // Handle
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const handleResolveError = async (errorId: string) => {
    setResolvingId(errorId);
    try {
      await apiClient.resolveAdminError(errorId);
      await loadErrors();
    } catch {
      // Handle
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel de Diagnóstico y Administración</h1>
          <p className="text-xs text-gray-500">Monitoreo de WordPress, Google Sheets, Google Drive y PostgreSQL</p>
        </div>
        <button
          onClick={onLogout}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded text-xs transition"
        >
          Cerrar Sesión
        </button>
      </div>

      <AdminIntegrationHealth
        health={health}
        loading={healthLoading}
        onRefresh={loadHealth}
      />

      <AdminTargetList
        targets={targets}
        loading={targetsLoading}
        onDiagnose={handleDiagnose}
        onViewForm={onSelectTarget}
      />

      <AdminErrorList
        errors={errors}
        loading={errorsLoading}
        onResolve={handleResolveError}
        resolvingId={resolvingId}
      />

      {isModalOpen && (
        <AdminDiagnosticsModal
          diagnostic={selectedTargetDiagnostic}
          loading={diagnosticLoading}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTargetDiagnostic(null);
          }}
        />
      )}
    </div>
  );
};
