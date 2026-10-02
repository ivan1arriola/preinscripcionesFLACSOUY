import React from 'react';

export interface TargetDeepDiagnostic {
  targetId: string;
  title: string;
  status: 'healthy' | 'warning' | 'error';
  wordpress: {
    status: 'ok' | 'warning' | 'error';
    valid: boolean;
    issues: string[];
    configRevision: string;
    registrationOpen: boolean;
    inputsCount: number;
  };
  sheets: {
    status: 'ok' | 'warning' | 'error' | 'not_configured';
    spreadsheetId?: string;
    sheetName?: string;
    missingColumns: string[];
    foundColumns: string[];
    issues: string[];
  };
  drive: {
    status: 'ok' | 'warning' | 'error' | 'not_configured';
    targetFolderId?: string;
    documentsFolderId?: string;
    issues: string[];
  };
  checkedAt: string;
}

interface Props {
  diagnostic: TargetDeepDiagnostic | null;
  loading: boolean;
  onClose: () => void;
}

export const AdminDiagnosticsModal: React.FC<Props> = ({ diagnostic, loading, onClose }) => {
  if (!diagnostic && !loading) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 font-bold text-lg"
          aria-label="Cerrar"
        >
          &times;
        </button>

        {loading || !diagnostic ? (
          <div className="py-12 text-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            Ejecutando diagnóstico en vivo de WordPress, Sheets y Drive...
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{diagnostic.title}</h3>
                <p className="text-xs text-gray-500 font-mono">ID: {diagnostic.targetId}</p>
              </div>
              <div>
                {diagnostic.status === 'healthy' && (
                  <span className="px-2.5 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">
                    Diagnóstico: Saludable
                  </span>
                )}
                {diagnostic.status === 'warning' && (
                  <span className="px-2.5 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                    Diagnóstico: Advertencias
                  </span>
                )}
                {diagnostic.status === 'error' && (
                  <span className="px-2.5 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">
                    Diagnóstico: Incompatible / Error
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-4 text-sm">
              {/* WordPress Section */}
              <div className="border rounded-md p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800 text-xs uppercase tracking-wider">WordPress REST v1</h4>
                  <span className={`text-xs font-semibold ${diagnostic.wordpress.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {diagnostic.wordpress.valid ? 'Contrato Válido' : 'Contrato Inválido'}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>Revisión: <span className="font-mono">{diagnostic.wordpress.configRevision}</span></p>
                  <p>Campos configurados: {diagnostic.wordpress.inputsCount}</p>
                  <p>Inscripción abierta: {diagnostic.wordpress.registrationOpen ? 'Sí' : 'No'}</p>
                </div>
                {diagnostic.wordpress.issues.length > 0 && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded border border-red-200">
                    {diagnostic.wordpress.issues.map((issue, idx) => (
                      <p key={idx}>&bull; {issue}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Google Sheets Section */}
              <div className="border rounded-md p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800 text-xs uppercase tracking-wider">Google Sheets</h4>
                  <span className={`text-xs font-semibold ${diagnostic.sheets.status === 'ok' ? 'text-green-600' : diagnostic.sheets.status === 'not_configured' ? 'text-gray-500' : 'text-red-600'}`}>
                    {diagnostic.sheets.status === 'ok' ? 'Columnas Compatibles' : diagnostic.sheets.status === 'not_configured' ? 'No configurado' : 'Incompatible'}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>Planilla ID: <span className="font-mono">{diagnostic.sheets.spreadsheetId || 'Sin asignar'}</span></p>
                  <p>Pestaña: {diagnostic.sheets.sheetName || 'Sheet1'}</p>
                  {diagnostic.sheets.missingColumns.length > 0 && (
                    <p className="text-red-600 font-medium">
                      Columnas faltantes requeridas: {diagnostic.sheets.missingColumns.join(', ')}
                    </p>
                  )}
                </div>
                {diagnostic.sheets.issues.length > 0 && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded border border-red-200">
                    {diagnostic.sheets.issues.map((issue, idx) => (
                      <p key={idx}>&bull; {issue}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Google Drive Section */}
              <div className="border rounded-md p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800 text-xs uppercase tracking-wider">Google Drive</h4>
                  <span className={`text-xs font-semibold ${diagnostic.drive.status === 'ok' ? 'text-green-600' : diagnostic.drive.status === 'not_configured' ? 'text-gray-500' : 'text-red-600'}`}>
                    {diagnostic.drive.status === 'ok' ? 'Carpetas Resueltas' : diagnostic.drive.status === 'not_configured' ? 'No configurado' : 'Error de acceso'}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>Carpeta destino: <span className="font-mono">{diagnostic.drive.targetFolderId || 'N/A'}</span></p>
                  <p>Subcarpeta documentos: <span className="font-mono">{diagnostic.drive.documentsFolderId || 'N/A'}</span></p>
                </div>
                {diagnostic.drive.issues.length > 0 && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded border border-red-200">
                    {diagnostic.drive.issues.map((issue, idx) => (
                      <p key={idx}>&bull; {issue}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
