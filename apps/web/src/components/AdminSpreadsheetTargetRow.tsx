import React from 'react';
import type { SpreadsheetTargetItem } from './admin-spreadsheet-view-model.js';

export interface AdminSpreadsheetTargetRowProps {
  target: SpreadsheetTargetItem;
  isExpanded: boolean;
  onToggleExpand: (targetId: string) => void;
  onUnlink: (targetId: string) => void;
  isUnlinking: boolean;
}

export const AdminSpreadsheetTargetRow: React.FC<AdminSpreadsheetTargetRowProps> = ({
  target,
  isExpanded,
  onToggleExpand,
  onUnlink,
  isUnlinking,
}) => {
  const hasActiveSheet =
    target.spreadsheet &&
    target.spreadsheet.status !== 'detached';

  const sheetUrl =
    target.spreadsheet?.url ??
    (target.spreadsheet?.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${target.spreadsheet.spreadsheetId}/edit`
      : undefined);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden transition-all">
      {/* Main compact row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{target.title}</span>
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[11px] text-gray-500 font-medium">
              {target.kind === 'seminar' ? 'Seminario' : 'Oferta académica'}
            </span>

            {target.spreadsheet?.status === 'blocked' && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-medium">
                Bloqueada
              </span>
            )}
            {target.spreadsheet?.status === 'reconciled' && (
              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-medium">
                Reconciliada
              </span>
            )}
            {target.spreadsheet?.status === 'created' && (
              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-medium">
                Activa
              </span>
            )}
            {target.spreadsheet?.status === 'unchanged' && (
              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-medium">
                Lista
              </span>
            )}
            {target.spreadsheet?.status === 'detached' && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-medium">
                Desvinculada
              </span>
            )}
            {!target.spreadsheet && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-medium">
                Pendiente
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {hasActiveSheet && sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded transition-colors"
            >
              <span>Abrir planilla</span>
              <span>↗</span>
            </a>
          ) : target.spreadsheet?.status === 'detached' ? (
            <span className="text-xs text-amber-700">Planilla desvinculada</span>
          ) : (
            <span className="text-xs text-amber-700 font-medium">Creación pendiente</span>
          )}

          <button
            type="button"
            onClick={() => onToggleExpand(target.targetId)}
            aria-expanded={isExpanded}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            {isExpanded ? 'Ocultar detalles' : 'Detalles'}
          </button>
        </div>
      </div>

      {/* Expanded details panel */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-gray-700">ID del destino:</span>{' '}
              <code className="text-gray-600 bg-gray-200/60 px-1 py-0.5 rounded font-mono text-[11px]">
                {target.targetId}
              </code>
            </div>

            {hasActiveSheet && (
              <button
                type="button"
                onClick={() => onUnlink(target.targetId)}
                disabled={isUnlinking}
                className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 underline"
              >
                {isUnlinking ? 'Desvinculando…' : 'Desvincular planilla'}
              </button>
            )}
          </div>

          {target.spreadsheet?.spreadsheetId && (
            <div>
              <span className="font-semibold text-gray-700">ID de Google Sheet:</span>{' '}
              <code className="text-gray-600 bg-gray-200/60 px-1 py-0.5 rounded font-mono text-[11px]">
                {target.spreadsheet.spreadsheetId}
              </code>
              {target.spreadsheet.sheetName && (
                <span className="text-gray-500 ml-2">
                  (Pestaña: {target.spreadsheet.sheetName})
                </span>
              )}
            </div>
          )}

          {target.spreadsheet?.status === 'blocked' && (
            <p className="text-red-700 text-xs">
              ⚠️ La planilla no pudo crearse o sincronizarse. Verificá los permisos de la cuenta de servicio en Google Drive.
            </p>
          )}

          {target.spreadsheet?.status === 'detached' && (
            <p className="text-amber-800 text-xs">
              Esta oferta ya no tiene una planilla activa vinculada. Usá &ldquo;Reintentar preparación&rdquo; arriba para crear o vincular una nueva planilla.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
