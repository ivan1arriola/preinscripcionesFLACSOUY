import { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from './api/client';
import { HomePage } from './pages/HomePage';
import { TargetPage } from './pages/TargetPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminProfilesPage } from './pages/AdminProfilesPage';
import { ClosedRegistrationNotice } from './components/ClosedRegistrationNotice';
import {
  HOME_PATH,
  normalizePath,
  legacyPathForTarget,
  resolveLegacyPermalink,
} from './domain/legacy-permalink-resolution';

const ADMIN_CALLBACK_PATH = '/accounts/google/login/callback/';

const isAdminPath = (path: string): boolean =>
  path.startsWith('/admin') || path === ADMIN_CALLBACK_PATH;

export function App() {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [closedNotice, setClosedNotice] = useState<{ isConflict: boolean; title?: string } | null>(null);
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (isAdminPath(path)) {
      setSelectedTargetId(null);
      setClosedNotice(null);
      setRouteError(null);
      return;
    }

    if (path === HOME_PATH) {
      setSelectedTargetId(null);
      setClosedNotice(null);
      setRouteError(null);
      return;
    }

    let active = true;
    setSelectedTargetId(null);
    setClosedNotice(null);
    setRouteError(null);

    apiClient.listTargets()
      .then((targets) => {
        if (!active) return;
        const resolution = resolveLegacyPermalink(targets, path);
        if (resolution.kind === 'target') {
          setSelectedTargetId(resolution.target.id);
        } else if (resolution.kind === 'closed') {
          setClosedNotice({ isConflict: false, title: resolution.title });
        } else if (resolution.kind === 'conflict') {
          setClosedNotice({ isConflict: true, title: resolution.title });
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
    setClosedNotice(null);
    setRouteError(null);
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

  const handleAdminLoginSuccess = () => {
    setIsAdminLoggedIn(true);
    if (path === ADMIN_CALLBACK_PATH) {
      window.history.replaceState({}, '', '/admin/perfiles/');
      setPath('/admin/perfiles/');
    }
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
            {isAdminPath(path) ? (
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
        {isAdminPath(path) ? (
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
              onLoginSuccess={handleAdminLoginSuccess}
            />
          )
        ) : selectedTargetId ? (
          <TargetPage targetId={selectedTargetId} onBack={handleGoHome} />
        ) : closedNotice ? (
          <ClosedRegistrationNotice
            title={closedNotice.title}
            isConflict={closedNotice.isConflict}
            onBack={handleGoHome}
          />
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
