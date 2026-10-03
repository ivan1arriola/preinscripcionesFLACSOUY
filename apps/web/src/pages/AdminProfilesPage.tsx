import React, { useState, useEffect } from 'react';
import { apiClient, ApiError } from '../api/client.js';
import { AdminDriveSettingsCard } from '../components/AdminDriveSettingsCard.js';
import { AdminSpreadsheetSettingsCard } from '../components/AdminSpreadsheetSettingsCard.js';

interface AdminProfilesPageProps {
  onRequireLogin: () => void;
  onLogout: () => void;
}

export const AdminProfilesPage: React.FC<AdminProfilesPageProps> = ({
  onRequireLogin,
  onLogout,
}) => {
  const [activeSection, setActiveSection] = useState<'profiles' | 'drive' | 'spreadsheets'>('profiles');
  const [adminUser, setAdminUser] = useState<any>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Check admin session
  useEffect(() => {
    let mounted = true;
    apiClient
      .getAdminMe()
      .then((data) => {
        if (mounted) {
          setAdminUser(data.user);
          setCsrfToken(data.csrfToken);
        }
      })
      .catch((err) => {
        if (mounted) {
          if (err instanceof ApiError && err.status === 401) {
            onRequireLogin();
          } else {
            setError('Error al verificar sesión administrativa.');
          }
        }
      });

    return () => {
      mounted = false;
    };
  }, [onRequireLogin]);

  const handleLogout = async () => {
    await apiClient.adminLogout(csrfToken);
    onLogout();
  };

  if (!adminUser) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Verificando sesión administrativa...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-gray-200 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Administración de Preinscripciones</h1>
          <p className="text-sm text-gray-600">
            Configuración del sistema, almacenamiento Google Drive y planillas por oferta.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="block text-sm font-medium text-gray-900">{adminUser.name}</span>
            <span className="block text-xs text-gray-500">{adminUser.email}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* Main Section Navigation */}
      <div className="flex gap-2 border-b border-gray-200 mb-6" role="tablist" aria-label="Secciones de administración">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'profiles'}
          onClick={() => setActiveSection('profiles')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeSection === 'profiles'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📋 Formularios Canónicos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'drive'}
          onClick={() => setActiveSection('drive')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeSection === 'drive'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📁 Almacenamiento Google Drive
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'spreadsheets'}
          onClick={() => setActiveSection('spreadsheets')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeSection === 'spreadsheets'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📊 Planillas por oferta
        </button>
      </div>

      {activeSection === 'drive' ? (
        <AdminDriveSettingsCard csrfToken={csrfToken} />
      ) : activeSection === 'spreadsheets' ? (
        <AdminSpreadsheetSettingsCard csrfToken={csrfToken} />
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 shadow-sm">
            <h2 className="text-lg font-bold text-blue-900 mb-2">
              Formularios Canónicos Activos (canonical-v1)
            </h2>
            <p className="text-sm text-blue-800 mb-4 leading-relaxed">
              La plataforma utiliza una definición canónica unificada y declarativa en código TypeScript. Los perfiles dinámicos y editables han sido reemplazados para garantizar estabilidad, consistencia y trazabilidad. Los cambios de formulario se realizan mediante revisiones de código y despliegues controlados.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-blue-900 mt-4 pt-4 border-t border-blue-200">
              <div>
                <h3 className="font-semibold mb-1">Estructura unificada (5 pasos)</h3>
                <ol className="list-decimal list-inside space-y-1 text-blue-800">
                  <li>Datos personales y demográficos</li>
                  <li>Residencia y contacto (incluye ciudad de residencia)</li>
                  <li>Trayectoria académica</li>
                  <li>Documentación requerida</li>
                  <li>Convenios y declaraciones</li>
                </ol>
              </div>
              <div>
                <h3 className="font-semibold mb-1">Documentación</h3>
                <ul className="list-disc list-inside space-y-1 text-blue-800">
                  <li>Base obligatoria: Cédula/documento, CV, Título y Carta de motivación.</li>
                  <li>Maestrías: solicitan dos cartas de recomendación adicionales (obligatorias).</li>
                  <li>Orientaciones, menciones y convenios se obtienen automáticamente desde WordPress.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
