import React, { useState } from 'react';
import { apiClient, ApiError } from '../../api/client';

interface Props {
  onSuccess: () => void;
  onCancel?: () => void;
}

export const AdminLoginPage: React.FC<Props> = ({ onSuccess, onCancel }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Por favor ingrese usuario y contraseña');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiClient.adminLogin(username, password);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error al iniciar sesión de administrador');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 bg-white rounded-lg shadow-sm border p-6">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xl mx-auto mb-3">
          🔒
        </div>
        <h2 className="text-xl font-bold text-gray-900">Acceso Administrativo</h2>
        <p className="text-xs text-gray-500 mt-1">
          Panel de diagnóstico y monitoreo de preinscripciones FLACSO Uruguay
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1" htmlFor="admin-user">
            Usuario
          </label>
          <input
            id="admin-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="admin"
            disabled={loading}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1" htmlFor="admin-pass">
            Contraseña
          </label>
          <input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition disabled:opacity-50"
        >
          {loading ? 'Ingresando...' : 'Iniciar Sesión'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded text-sm transition"
          >
            Volver al inicio
          </button>
        )}
      </form>
    </div>
  );
};
