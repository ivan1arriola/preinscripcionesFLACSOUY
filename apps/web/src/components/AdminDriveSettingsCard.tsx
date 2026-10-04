import React, { useState, useEffect } from 'react';
import { apiClient, ApiError } from '../api/client.js';

interface AdminDriveSettingsCardProps {
  csrfToken: string;
}

export const AdminDriveSettingsCard: React.FC<AdminDriveSettingsCardProps> = ({ csrfToken }) => {
  const [folderId, setFolderId] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(null);
  const [canAddChildren, setCanAddChildren] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<{
    status: 'completed' | 'blocked';
    targets: Array<{ targetId: string; status: string; message?: string }>;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAdminSettings();
      setCurrentFolderId(data.googleDriveFolderId);
      setFolderId(data.googleDriveFolderId ?? '');
      setCurrentFolderName(data.googleDriveFolderName);
      setCanAddChildren(data.googleDriveCanAddChildren);
      setServiceAccountEmail(data.serviceAccountEmail);
      setUpdatedAt(data.updatedAt);
      setUpdatedBy(data.updatedBy);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al cargar la configuración de Google Drive');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    setReconciliation(null);

    try {
      const res = await apiClient.updateGoogleDriveFolder(folderId, csrfToken);
      setCurrentFolderId(res.googleDriveFolderId);
      setFolderId(res.googleDriveFolderId);
      setCurrentFolderName(res.googleDriveFolderName);
      setCanAddChildren(res.googleDriveCanAddChildren);

      if (res.reconciliation) {
        setReconciliation(res.reconciliation);
        if (res.reconciliation.status === 'blocked') {
          setError('La carpeta raíz fue actualizada, pero algunas planillas no pudieron reconciliarse y quedaron bloqueadas.');
        } else {
          setSuccess('Carpeta de Google Drive actualizada y planillas reconciliadas correctamente.');
        }
      } else {
        setSuccess('Carpeta de Google Drive actualizada correctamente.');
      }
      loadSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar la carpeta de Google Drive');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyEmail = () => {
    if (!serviceAccountEmail) return;
    navigator.clipboard.writeText(serviceAccountEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm text-center">
        <p className="text-gray-500 text-sm">Cargando configuración de Google Drive...</p>
      </div>
    );
  }

  const driveUrl = currentFolderId ? `https://drive.google.com/drive/folders/${currentFolderId}` : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>📁</span> Carpeta de Google Drive para Documentación
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Aquí se almacenan los archivos adjuntos (cédulas, títulos, CVs) de las preinscripciones enviadas.
          </p>
        </div>

        {currentFolderId && driveUrl && (
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-medium transition-colors border border-blue-200"
          >
            <span>Abrir en Google Drive</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="drive-folder-input" className="block text-xs font-semibold text-gray-700 mb-1">
            ID o URL de la carpeta:
          </label>
          <div className="flex gap-2">
            <input
              id="drive-folder-input"
              type="text"
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              placeholder="Ej: 1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e o https://drive.google.com/drive/folders/..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
            <button
              type="submit"
              disabled={saving || !folderId.trim() || folderId.trim() === currentFolderId}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium text-xs rounded-lg transition-colors shadow-sm disabled:cursor-not-allowed whitespace-nowrap"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Puedes pegar el ID directo o el enlace completo del navegador. El sistema extraerá automáticamente el identificador.
          </p>
          {currentFolderId && folderId.trim() && folderId.trim() !== currentFolderId && (
            <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 mt-2">
              ⚠️ Al cambiar la carpeta raíz, el sistema reubicará o reconciliará automáticamente las planillas existentes de cada oferta hacia la nueva jerarquía de Google Drive.
            </p>
          )}
        </div>
      </form>

      {reconciliation && (
        <div className={`mt-4 p-3 rounded-lg border text-xs ${reconciliation.status === 'completed' ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="font-semibold mb-1">
            {reconciliation.status === 'completed' ? 'Resultado de reconciliación de planillas:' : 'Atención en la reconciliación de planillas:'}
          </div>
          <ul className="space-y-1 mt-1.5 list-disc list-inside">
            {reconciliation.targets.map((t) => (
              <li key={t.targetId} className={t.status === 'blocked' ? 'text-red-700 font-medium' : 'text-gray-700'}>
                <strong>{t.targetId}</strong>: {t.status === 'blocked' ? `Bloqueada (${t.message || 'error de permisos'})` : t.status === 'reconciled' ? 'Reconciliada' : t.status === 'created' ? 'Creada' : 'Sin cambios'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentFolderId && (
        <div className={`mt-4 p-3 rounded-lg border text-xs ${canAddChildren ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <strong>{currentFolderName || 'Carpeta configurada'}</strong>
          {' — '}
          {canAddChildren ? 'La cuenta de servicio puede crear archivos y subcarpetas.' : 'La cuenta de servicio no tiene permisos suficientes para crear archivos o subcarpetas.'}
        </div>
      )}

      {/* Service Account sharing advice box */}
      {serviceAccountEmail && (
        <div className="mt-5 p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900">
          <div className="font-semibold mb-1 flex items-center gap-1.5 text-amber-950">
            <span>ℹ️</span> Acceso requerido en Google Drive:
          </div>
          <p className="mb-2 text-amber-800 leading-relaxed">
            Para que las preinscripciones puedan subir los documentos a esta carpeta, debes compartirla con rol de <strong>Editor</strong> al siguiente correo de la cuenta de servicio institucional:
          </p>
          <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded border border-amber-300">
            <code className="text-[11px] font-mono select-all flex-1 text-gray-800 break-all">
              {serviceAccountEmail}
            </code>
            <button
              type="button"
              onClick={handleCopyEmail}
              className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-[11px] font-medium transition-colors"
            >
              {copied ? '¡Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {updatedAt && (
        <div className="mt-3 text-[11px] text-gray-400 text-right">
          Última actualización: {new Date(updatedAt).toLocaleString('es-UY')} {updatedBy && `por ${updatedBy}`}
        </div>
      )}
    </div>
  );
};
