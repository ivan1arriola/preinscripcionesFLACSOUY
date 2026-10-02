import React, { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiError } from '../api/client.js';
import { ProfileVersionEditor } from '../components/ProfileVersionEditor.js';
import { AdminDriveSettingsCard } from '../components/AdminDriveSettingsCard.js';

interface AdminProfilesPageProps {
  onRequireLogin: () => void;
  onLogout: () => void;
}

const PROFILE_TYPE_LABELS: Record<string, string> = {
  diploma: 'Diplomas',
  maestria: 'Maestrías',
  especializacion: 'Especializaciones',
  diplomado: 'Diplomados',
  seminar: 'Seminarios',
};

export const AdminProfilesPage: React.FC<AdminProfilesPageProps> = ({
  onRequireLogin,
  onLogout,
}) => {
  const [activeSection, setActiveSection] = useState<'profiles' | 'drive'>('profiles');
  const [adminUser, setAdminUser] = useState<any>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState<string>('diploma');
  const [selectedProfileDetail, setSelectedProfileDetail] = useState<{
    profile: any;
    activeVersion: any;
    versions: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Check session
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

  // 2. Load profiles list
  const loadProfiles = useCallback(async () => {
    try {
      const list = await apiClient.listAdminProfiles();
      setProfiles(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onRequireLogin();
      } else {
        setError('Error al cargar la lista de perfiles.');
      }
    }
  }, [onRequireLogin]);

  useEffect(() => {
    if (adminUser) {
      loadProfiles();
    }
  }, [adminUser, loadProfiles]);

  // 3. Load selected profile detail
  const loadProfileDetail = useCallback(async (type: string, isReload = false) => {
    if (!isReload) {
      setLoading(true);
    }
    setError(null);
    try {
      const detail = await apiClient.getAdminProfile(type);
      setSelectedProfileDetail(detail);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onRequireLogin();
      } else {
        setError(`Error al cargar el perfil de ${type}.`);
      }
    } finally {
      if (!isReload) {
        setLoading(false);
      }
    }
  }, [onRequireLogin]);

  useEffect(() => {
    if (adminUser && selectedType) {
      loadProfileDetail(selectedType);
    }
  }, [adminUser, selectedType, loadProfileDetail]);

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
          <h1 className="text-2xl font-bold text-gray-900">Perfiles de Formulario</h1>
          <p className="text-sm text-gray-600">
            Administración de esquemas inmutables por tipo de oferta académica.
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
          📋 Perfiles de Formulario
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
      </div>

      {activeSection === 'drive' ? (
        <AdminDriveSettingsCard csrfToken={csrfToken} />
      ) : (
        <>
          {/* Tabs for Offer Types */}
          <div className="flex border-b border-gray-200 mb-8 overflow-x-auto" role="tablist" aria-label="Tipos de oferta">
            {['diploma', 'maestria', 'especializacion', 'diplomado', 'seminar'].map((type) => {
              const profileItem = profiles.find((p) => p.type === type);
              const isSelected = selectedType === type;
              const label = profileItem?.name ?? PROFILE_TYPE_LABELS[type] ?? type;

              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedType(type)}
                  className={`py-3 px-6 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    isSelected
                      ? 'border-blue-600 text-blue-600 font-semibold'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Profile Detail and Editor */}
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Cargando perfil...</p>
            </div>
          ) : selectedProfileDetail ? (
            <ProfileVersionEditor
              profile={selectedProfileDetail.profile}
              activeVersion={selectedProfileDetail.activeVersion}
              versions={selectedProfileDetail.versions}
              csrfToken={csrfToken}
              onRefresh={() => {
                loadProfiles();
                loadProfileDetail(selectedType, true);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
};
