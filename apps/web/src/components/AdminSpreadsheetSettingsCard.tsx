import React, { useEffect, useState } from 'react';
import { apiClient, ApiError } from '../api/client.js';
import {
  filterSpreadsheetTargets,
  summarizeSpreadsheetTargets,
  isAttentionTarget,
  type SpreadsheetTargetItem,
  type SpreadsheetTargetKindFilter,
  type SpreadsheetTargetStatusFilter,
} from './admin-spreadsheet-view-model.js';
import { AdminSpreadsheetTargetRow } from './AdminSpreadsheetTargetRow.js';

interface AdminSpreadsheetSettingsCardProps {
  csrfToken: string;
}

export const AdminSpreadsheetSettingsCard: React.FC<AdminSpreadsheetSettingsCardProps> = ({ csrfToken }) => {
  const [targets, setTargets] = useState<SpreadsheetTargetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  // View state
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<SpreadsheetTargetKindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<SpreadsheetTargetStatusFilter>('all');
  const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);

  // keepMessages evita borrar el error o el aviso que acaba de dejar una acción (p. ej. planillas bloqueadas).
  const load = async (synchronizeMissing = true, keepMessages = false) => {
    setLoading(true);
    if (!keepMessages) setError(null);
    try {
      const data = await apiClient.getAdminSpreadsheets();
      setTargets(data.targets);
      if (synchronizeMissing && data.targets.some((target) => !target.spreadsheet)) {
        setProvisioning(true);
        const result = await apiClient.provisionAdminSpreadsheets(csrfToken);
        setSummary(result?.reconciliation?.status === 'blocked'
          ? 'La aplicación preparó las planillas disponibles. Algunas requieren revisar los permisos de la carpeta en Google Drive.'
          : 'La aplicación sincronizó el formato de las planillas existentes y preparó las nuevas.');
        const refreshed = await apiClient.getAdminSpreadsheets();
        setTargets(refreshed.targets);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear o consultar las planillas automáticamente.');
    } finally {
      setLoading(false);
      setProvisioning(false);
    }
  };

  // Crear planillas en Drive es una acción explícita (botón «Sincronizar formato»), no un efecto de abrir la pestaña.
  useEffect(() => { load(false); }, []);

  const provision = async () => {
    setProvisioning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await apiClient.provisionAdminSpreadsheets(csrfToken);
      if (res.reconciliation?.status === 'blocked') {
        setError('Algunas planillas no pudieron crearse porque la cuenta de servicio no tiene acceso suficiente a Google Drive. Revisá la carpeta en “Almacenamiento Google Drive”.');
      } else {
        setSummary('Planillas sincronizadas con el formato del formulario.');
      }
      await load(false, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron sincronizar las planillas automáticamente.');
    } finally {
      setProvisioning(false);
    }
  };

  const unlink = async (targetId: string) => {
    if (!window.confirm('La planilla se conservará en Google Drive, pero dejará de ser la activa. ¿Continuar?')) return;
    setUnlinking(targetId); setError(null); setSummary(null);
    try {
      const result = await apiClient.unlinkAdminSpreadsheet(targetId, csrfToken);
      setSummary(result.message);
      await load(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo desvincular la planilla.');
    } finally { setUnlinking(null); }
  };

  const handleToggleExpand = (targetId: string) => {
    setExpandedTargetId((curr) => (curr === targetId ? null : targetId));
  };

  const handleClearFilters = () => {
    setQuery('');
    setKindFilter('all');
    setStatusFilter('all');
  };

  // Derived metrics and filtered targets
  const metrics = summarizeSpreadsheetTargets(targets);
  const filteredTargets = filterSpreadsheetTargets(targets, query, kindFilter, statusFilter);
  const attentionTargets = filteredTargets.filter(isAttentionTarget);
  const availableTargets = filteredTargets.filter((t) => !isAttentionTarget(t));
  const hasActiveFilters = query.trim() !== '' || kindFilter !== 'all' || statusFilter !== 'all';

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>📊</span> Planillas automáticas por oferta
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Cada oferta y seminario tiene una planilla propia en Google Drive. Esta bandeja operativa te permite monitorear su estado, buscar destinos y abrir o gestionar cada planilla.
          </p>
        </div>
        <button
          type="button"
          onClick={provision}
          disabled={loading || provisioning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors shadow-sm"
        >
          {provisioning ? 'Sincronizando planillas...' : 'Sincronizar formato'}
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {summary && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">{summary}</div>}

      {/* Metrics Header */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Total</span>
            <span className="text-base font-bold text-slate-800">{metrics.total} destinos</span>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg p-3">
            <span className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider block">Disponibles</span>
            <span className="text-base font-bold text-emerald-800">{metrics.ready} lista/activa{metrics.ready === 1 ? '' : 's'}</span>
          </div>
          <div className={`rounded-lg p-3 border ${metrics.attention > 0 ? 'bg-amber-50/80 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200/80 text-slate-600'}`}>
            <span className="text-[11px] font-medium uppercase tracking-wider block">Atención</span>
            <span className="text-base font-bold">{metrics.attention} requieren atención</span>
          </div>
          <div className={`rounded-lg p-3 border ${metrics.blocked > 0 ? 'bg-red-50/80 border-red-200 text-red-900' : 'bg-slate-50 border-slate-200/80 text-slate-600'}`}>
            <span className="text-[11px] font-medium uppercase tracking-wider block">Bloqueadas</span>
            <span className="text-base font-bold">{metrics.blocked} bloqueada{metrics.blocked === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}

      {/* Filter and Search Controls */}
      {!loading && targets.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 mb-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="spreadsheet-search" className="sr-only">
                Buscar por título o código
              </label>
              <input
                id="spreadsheet-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por título o código..."
                className="w-full text-xs p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div>
                <label htmlFor="spreadsheet-kind-filter" className="sr-only">
                  Tipo de oferta
                </label>
                <select
                  id="spreadsheet-kind-filter"
                  aria-label="Tipo de oferta"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value as SpreadsheetTargetKindFilter)}
                  className="text-xs p-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">Todos los tipos</option>
                  <option value="offer">Ofertas académicas</option>
                  <option value="seminar">Seminarios</option>
                </select>
              </div>

              <div>
                <label htmlFor="spreadsheet-status-filter" className="sr-only">
                  Estado
                </label>
                <select
                  id="spreadsheet-status-filter"
                  aria-label="Estado"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as SpreadsheetTargetStatusFilter)}
                  className="text-xs p-2 border border-gray-300 rounded-md bg-white text-gray-700 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">Todos los estados</option>
                  <option value="attention">Requieren atención</option>
                  <option value="ready">Listas / Activas</option>
                  <option value="detached">Desvinculadas</option>
                </select>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1.5 rounded hover:bg-gray-200 transition-colors"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-500">Cargando destinos...</p>
        </div>
      ) : targets.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          No hay ofertas abiertas que requieran una planilla.
        </div>
      ) : filteredTargets.length === 0 ? (
        <div className="py-8 text-center space-y-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <p className="text-sm text-gray-600">No se encontraron planillas con los filtros aplicados.</p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Attention Group */}
          {attentionTargets.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5 px-1">
                <span>⚠️</span>
                <span>Requieren atención ({attentionTargets.length})</span>
              </h3>
              <div className="space-y-2">
                {attentionTargets.map((target) => (
                  <AdminSpreadsheetTargetRow
                    key={target.targetId}
                    target={target}
                    isExpanded={expandedTargetId === target.targetId}
                    onToggleExpand={handleToggleExpand}
                    onUnlink={unlink}
                    isUnlinking={unlinking === target.targetId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Available / Ready Group */}
          {availableTargets.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 px-1">
                <span>📋</span>
                <span>Planillas disponibles ({availableTargets.length})</span>
              </h3>
              <div className="space-y-2">
                {availableTargets.map((target) => (
                  <AdminSpreadsheetTargetRow
                    key={target.targetId}
                    target={target}
                    isExpanded={expandedTargetId === target.targetId}
                    onToggleExpand={handleToggleExpand}
                    onUnlink={unlink}
                    isUnlinking={unlinking === target.targetId}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
