import { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from './api/client';
import { HomePage } from './pages/HomePage';
import { TargetPage } from './pages/TargetPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminProfilesPage } from './pages/AdminProfilesPage';

const HOME_PATH = '/';

const normalizePath = (path: string): string => {
  if (path === HOME_PATH) return HOME_PATH;
  return path.endsWith('/') ? path : `${path}/`;
};

const legacyPathForTarget = (target: DiagnosticTarget): string | null => {
  const legacyRegistration = target.urls?.legacyRegistration;
  if (!legacyRegistration) return null;

  const path = normalizePath(new URL(legacyRegistration).pathname);
  return /^\/(oferta|seminario)\/[^/]+\/$/.test(path) ? path : null;
};

export function App() {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (path.startsWith('/admin')) {
      setSelectedTargetId(null);
      setRouteError(null);
      return;
    }

    if (path === HOME_PATH) {
      setSelectedTargetId(null);
      setRouteError(null);
      return;
    }

    let active = true;
    setSelectedTargetId(null);
    setRouteError(null);

    apiClient.listTargets()
      .then((targets) => {
        if (!active) return;
        const target = targets.find((candidate) => legacyPathForTarget(candidate) === path);
        if (target) {
          setSelectedTargetId(target.id);
        } else {
          setRouteError('No encontramos una preinscripción para este enlace.');
        }
      })
      .catch(() => {
        if (active) {
          setRouteError('No pudimos verificar este enlace. Intente nuevamente más tarde.');
        }
      });

    return () => {
      active = false;
    };
  }, [path]);

  const handleGoHome = () => {
    window.history.pushState({}, '', HOME_PATH);
    setPath(HOME_PATH);
    setSelectedTargetId(null);
  };

  const handleSelectTarget = (target: DiagnosticTarget) => {
    const legacyPath = legacyPathForTarget(target);
    if (legacyPath) {
      window.history.pushState({}, '', legacyPath);
      setPath(legacyPath);
      return;
    }

    setSelectedTargetId(target.id);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div
            className="flex items-center space-x-3 cursor-pointer"
            onClick={handleGoHome}
          >
            <div className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
              F
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">FLACSO Uruguay</h1>
              <p className="text-xs text-gray-500">Sistema de Preinscripciones</p>
            </div>
          </div>

          <div>
            {path.startsWith('/admin') ? (
              <button
                type="button"
                onClick={handleGoHome}
                className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2.5 py-1.5"
              >
                Volver al inicio
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.history.pushState({}, '', '/admin/perfiles');
                  setPath('/admin/perfiles/');
                }}
                className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2.5 py-1.5"
              >
                Administración
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {path.startsWith('/admin') ? (
          isAdminLoggedIn ? (
            <AdminProfilesPage
              onRequireLogin={() => setIsAdminLoggedIn(false)}
              onLogout={() => {
                setIsAdminLoggedIn(false);
                handleGoHome();
              }}
            />
          ) : (
            <AdminLoginPage
              onLoginSuccess={() => setIsAdminLoggedIn(true)}
            />
          )
        ) : selectedTargetId ? (
          <TargetPage targetId={selectedTargetId} onBack={handleGoHome} />
        ) : routeError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900" role="alert">
            <p className="font-medium">{routeError}</p>
            <button type="button" onClick={handleGoHome} className="mt-3 text-sm font-medium text-blue-700 hover:underline">
              Ver todas las preinscripciones
            </button>
          </div>
        ) : (
          <HomePage onSelectTarget={handleSelectTarget} />
        )}
      </main>

      <footer className="bg-white border-t mt-auto py-4 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} FLACSO Uruguay &middot; Plataforma de Preinscripciones
      </footer>
    </div>
  );
}

export default App;
