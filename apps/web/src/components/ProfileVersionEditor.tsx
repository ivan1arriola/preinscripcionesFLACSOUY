import React, { useState, useEffect } from 'react';
import { apiClient, ApiError } from '../api/client.js';

interface ProfileVersionEditorProps {
  profile: any;
  activeVersion: any;
  versions: any[];
  csrfToken: string;
  onRefresh: () => void;
}

export const ProfileVersionEditor: React.FC<ProfileVersionEditorProps> = ({
  profile,
  activeVersion,
  versions,
  csrfToken,
  onRefresh,
}) => {
  const [definitionJson, setDefinitionJson] = useState(
    JSON.stringify(activeVersion?.definition ?? {}, null, 2)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeVersion?.definition) {
      setDefinitionJson(JSON.stringify(activeVersion.definition, null, 2));
    }
  }, [activeVersion]);

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    let parsedDefinition;
    try {
      parsedDefinition = JSON.parse(definitionJson);
    } catch {
      setError('El contenido debe ser un JSON válido.');
      setIsSubmitting(false);
      return;
    }

    try {
      const newVersion = await apiClient.createProfileVersion(
        profile.type,
        parsedDefinition,
        csrfToken
      );
      setSuccessMessage(
        `Versión #${newVersion.versionNumber} creada exitosamente. Podés activarla desde el historial.`
      );
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error al crear la versión del perfil.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivate = async (versionId: string, versionNumber: number) => {
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      await apiClient.activateProfileVersion(profile.type, versionId, csrfToken);
      setSuccessMessage(`Versión #${versionNumber} activada como la versión vigente.`);
      onRefresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error al activar la versión del perfil.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          Perfil: {profile.name} ({profile.type})
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Versión activa actual:{' '}
          <strong className="text-blue-600">
            #{activeVersion?.versionNumber ?? 'Ninguna'}
          </strong>
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm">
          {successMessage}
        </div>
      )}

      {/* Editor to create new version */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-md font-semibold text-gray-800">
          Crear nueva versión de formulario
        </h3>
        <p className="text-xs text-gray-500">
          Modificá la estructura de pasos, campos y documentos. Al guardar, se generará una versión inmutable con número incremental.
        </p>

        <form onSubmit={handleCreateVersion} className="space-y-4">
          <div>
            <label htmlFor="definition-editor" className="sr-only">
              Definición JSON del perfil
            </label>
            <textarea
              id="definition-editor"
              value={definitionJson}
              onChange={(e) => setDefinitionJson(e.target.value)}
              rows={16}
              className="w-full font-mono text-xs p-3 rounded border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando…' : 'Crear nueva versión'}
            </button>
          </div>
        </form>
      </div>

      {/* Version History & Activation */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-md font-semibold text-gray-800">Historial de versiones</h3>
        <div className="divide-y divide-gray-200">
          {versions.map((ver) => {
            const isActive = ver.id === profile.activeVersionId;
            return (
              <div
                key={ver.id}
                className="py-3 flex items-center justify-between text-sm"
              >
                <div>
                  <span className="font-semibold text-gray-900 mr-2">
                    Versión #{ver.versionNumber}
                  </span>
                  {isActive && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      Activa
                    </span>
                  )}
                  <span className="text-xs text-gray-500 ml-3">
                    Creada por: {ver.createdBy}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDefinitionJson(JSON.stringify(ver.definition, null, 2))
                    }
                    className="text-xs text-blue-600 hover:underline mr-2"
                  >
                    Cargar al editor
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleActivate(ver.id, ver.versionNumber)}
                      className="px-3 py-1 bg-gray-100 hover:bg-green-600 hover:text-white rounded text-xs font-medium border border-gray-300 transition-colors disabled:opacity-50"
                    >
                      Activar esta versión
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
