import { useEffect, useState } from 'react';
import type { DiagnosticTarget } from '@flacso/contracts';
import { apiClient } from './api/client';
import { initTracking } from './api/meta-pixel';
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
  const [isAdminChecking, setIsAdminChecking] = useState(() => isAdminPath(path) && path !== ADMIN_CALLBACK_PATH);

  useEffect(() => {
    if (isAdminPath(path)) return;
    apiClient.getPublicConfig().then(initTracking).catch(() => {});
  }, [path]);

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!isAdminPath(path) || path === ADMIN_CALLBACK_PATH || isAdminLoggedIn) {
      setIsAdminChecking(false);
      return;
    }

    let active = true;
    setIsAdminChecking(true);

    apiClient
      .getAdminMe()
      .then(() => {
        if (!active) return;
        setIsAdminLoggedIn(true);
        setIsAdminChecking(false);
      })
      .catch(() => {
        if (!active) return;
        setIsAdminLoggedIn(false);
        setIsAdminChecking(false);
      });

    return () => {
      active = false;
    };
  }, [path, isAdminLoggedIn]);

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
    <div className="app-shell min-h-screen bg-gray-50 flex flex-col">
      <header className="app-header">
        <div className="app-header-content max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div
            className="app-brand flex items-center cursor-pointer"
            onClick={handleGoHome}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') handleGoHome();
            }}
          >
            <img className="app-brand-logo" src="/logo-flacso-claro.png" alt="FLACSO Uruguay" width="104" height="42" />
            <span className="app-brand-divider" aria-hidden="true" />
            <p className="app-brand-title">Preinscripciones</p>
          </div>

          <div>
            {isAdminPath(path) ? (
              <button
                type="button"
                onClick={handleGoHome}
                className="app-header-action"
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
                className="app-header-action"
              >
                Administración
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {isAdminPath(path) ? (
          isAdminChecking ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Verificando sesión administrativa...</p>
            </div>
          ) : isAdminLoggedIn ? (
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
          <div className="page-notice" role="alert">
            <div>
              <p>{routeError}</p>
              <button type="button" onClick={handleGoHome} className="btn btn-secondary">
                Ver todas las preinscripciones
              </button>
            </div>
          </div>
        ) : (
          <HomePage onSelectTarget={handleSelectTarget} />
        )}
      </main>

      <footer className="app-footer bg-white border-t mt-auto py-4 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} FLACSO Uruguay &middot; Plataforma de Preinscripciones
      </footer>
    </div>
  );
}

export default App;
