import { useState, useEffect } from 'react';
import { HomePage } from './pages/HomePage';
import { TargetPage } from './pages/TargetPage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { apiClient } from './api/client';

export function App() {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isAdminView, setIsAdminView] = useState<boolean>(() => {
    return window.location.pathname.startsWith('/admin') || window.location.hash === '#admin';
  });
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    return !!apiClient.getAdminToken();
  });

  useEffect(() => {
    if (isAdminView && apiClient.getAdminToken()) {
      apiClient.getAdminMe().catch(() => {
        setIsAdminAuthenticated(false);
      });
    }
  }, [isAdminView]);

  const handleGoHome = () => {
    setSelectedTargetId(null);
    setIsAdminView(false);
    if (window.location.hash === '#admin') {
      window.location.hash = '';
    }
  };

  const handleOpenAdmin = () => {
    setSelectedTargetId(null);
    setIsAdminView(true);
  };

  const handleLogout = async () => {
    await apiClient.adminLogout();
    setIsAdminAuthenticated(false);
    setIsAdminView(false);
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

          <div className="flex items-center space-x-3">
            {isAdminView ? (
              <button
                onClick={handleGoHome}
                className="text-xs text-gray-600 hover:text-gray-900 font-medium"
              >
                Volver al Portal
              </button>
            ) : (
              <button
                onClick={handleOpenAdmin}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Panel de Diagnóstico
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {isAdminView ? (
          isAdminAuthenticated ? (
            <AdminDashboardPage
              onLogout={handleLogout}
              onSelectTarget={(id) => {
                setSelectedTargetId(id);
                setIsAdminView(false);
              }}
            />
          ) : (
            <AdminLoginPage
              onSuccess={() => setIsAdminAuthenticated(true)}
              onCancel={handleGoHome}
            />
          )
        ) : selectedTargetId ? (
          <TargetPage targetId={selectedTargetId} onBack={() => setSelectedTargetId(null)} />
        ) : (
          <HomePage onSelectTarget={(id: string) => setSelectedTargetId(id)} />
        )}
      </main>

      <footer className="bg-white border-t mt-auto py-4 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} FLACSO Uruguay &middot; Plataforma de Preinscripciones
      </footer>
    </div>
  );
}

export default App;
