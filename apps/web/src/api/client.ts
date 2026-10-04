import type { DiagnosticTarget, FormDefinition, SubmissionFileToken } from '@flacso/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly issues?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = {
  sessionId(): string {
    const key = 'flacso-preinscription-session';
    const current = sessionStorage.getItem(key);
    if (current) return current;
    const generated = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, generated);
    return generated;
  },

  async upload(targetId: string, fieldKey: string, file: File): Promise<SubmissionFileToken> {
    const body = new FormData();
    body.append('targetId', targetId);
    body.append('fieldKey', fieldKey);
    body.append('file', file);
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'x-preinscription-session': apiClient.sessionId() },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UPLOAD_ERROR', err.error?.message || 'No se pudo cargar el archivo.');
    }
    return res.json();
  },

  async removeUpload(token: string): Promise<void> {
    const res = await fetch(`/api/uploads/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: { 'x-preinscription-session': apiClient.sessionId() },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'DELETE_ERROR', err.error?.message || 'No se pudo eliminar el archivo.');
    }
  },

  async listTargets(): Promise<DiagnosticTarget[]> {
    const res = await fetch('/api/targets');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error?.code || 'UNKNOWN_ERROR',
        err.error?.message || 'Error al listar destinos académicos'
      );
    }
    const data = await res.json();
    return data.targets;
  },

  async getTarget(id: string): Promise<FormDefinition> {
    const res = await fetch(`/api/targets/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error?.code || 'UNKNOWN_ERROR',
        err.error?.message || `Error al obtener destino ${id}`,
        undefined,
        err.error?.issues
      );
    }
    return res.json();
  },

  async submit(
    id: string,
    configRevision: string,
    values: Record<string, string>,
    files: SubmissionFileToken[] = []
  ): Promise<{ submissionId: string }> {
    const res = await fetch(`/api/targets/${encodeURIComponent(id)}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-preinscription-session': apiClient.sessionId() },
      body: JSON.stringify({ configRevision, values, files }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error?.code || 'SUBMISSION_ERROR',
        err.error?.message || 'Error al procesar la preinscripción',
        err.error?.fieldErrors,
        err.error?.issues
      );
    }

    return res.json();
  },

  async getAdminAuthUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    const res = await fetch(`/api/admin/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`);
    if (!res.ok) throw new ApiError(res.status, 'AUTH_URL_ERROR', 'Error al obtener URL de autenticación');
    return res.json();
  },

  async adminLogin(code: string, redirectUri: string, nonce?: string): Promise<{ user: any; csrfToken: string }> {
    const res = await fetch('/api/admin/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri, nonce }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'AUTH_ERROR', err.error?.message || 'Error de autenticación');
    }
    return res.json();
  },

  async adminLogout(csrfToken?: string): Promise<void> {
    await fetch('/api/admin/auth/logout', {
      method: 'POST',
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
    });
  },

  async getAdminMe(): Promise<{ user: any; csrfToken: string }> {
    const res = await fetch('/api/admin/me');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UNAUTHORIZED', err.error?.message || 'No autenticado');
    }
    return res.json();
  },

  async listAdminProfiles(): Promise<any[]> {
    const res = await fetch('/api/admin/profiles');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'PROFILES_ERROR', err.error?.message || 'Error al listar perfiles');
    }
    const data = await res.json();
    return data.profiles;
  },

  async getAdminProfile(type: string): Promise<{ profile: any; activeVersion: any; versions: any[] }> {
    const res = await fetch(`/api/admin/profiles/${encodeURIComponent(type)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'PROFILE_ERROR', err.error?.message || 'Error al obtener perfil');
    }
    return res.json();
  },

  async createProfileVersion(type: string, definition: any, csrfToken: string): Promise<any> {
    const res = await fetch(`/api/admin/profiles/${encodeURIComponent(type)}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ definition }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'CREATE_VERSION_ERROR', err.error?.message || 'Error al crear versión');
    }
    const data = await res.json();
    return data.version;
  },

  async activateProfileVersion(type: string, versionId: string, csrfToken: string): Promise<void> {
    const res = await fetch(`/api/admin/profiles/${encodeURIComponent(type)}/activate/${encodeURIComponent(versionId)}`, {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'ACTIVATE_VERSION_ERROR', err.error?.message || 'Error al activar versión');
    }
  },

  async getAdminSettings(): Promise<{
    googleDriveFolderId: string | null;
    googleDriveFolderName: string | null;
    googleDriveCanAddChildren: boolean;
    serviceAccountEmail: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  }> {
    const res = await fetch('/api/admin/settings');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'SETTINGS_ERROR', err.error?.message || 'Error al obtener configuración');
    }
    return res.json();
  },

  async updateGoogleDriveFolder(folderId: string, csrfToken: string): Promise<{
    ok: boolean;
    googleDriveFolderId: string;
    googleDriveFolderName: string;
    googleDriveCanAddChildren: boolean;
    reconciliation?: {
      status: 'completed' | 'blocked';
      targets: Array<{
        targetId: string;
        status: 'reconciled' | 'created' | 'unchanged' | 'blocked';
        spreadsheetId?: string;
        code?: string;
        message?: string;
      }>;
    };
  }> {
    const res = await fetch('/api/admin/settings/google-drive', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ folderId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UPDATE_SETTINGS_ERROR', err.error?.message || 'Error al actualizar carpeta de Google Drive');
    }
    return res.json();
  },

  async getAdminSpreadsheets(): Promise<{
    targets: Array<{
      targetId: string;
      title: string;
      kind: string;
      spreadsheet: {
        spreadsheetId: string;
        sheetName: string;
        url?: string;
        status?: 'reconciled' | 'created' | 'unchanged' | 'blocked';
        rootFolderId?: string;
      } | null;
    }>;
  }> {
    const res = await fetch('/api/admin/settings/spreadsheets');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'SPREADSHEETS_ERROR', err.error?.message || 'Error al obtener las planillas');
    }
    return res.json();
  },

  async provisionAdminSpreadsheets(csrfToken: string): Promise<{
    ok: boolean;
    spreadsheets: Array<{ targetId: string; spreadsheetId: string; sheetName: string; url?: string }>;
    reconciliation?: {
      status: 'completed' | 'blocked';
      targets: Array<{
        targetId: string;
        status: 'reconciled' | 'created' | 'unchanged' | 'blocked';
        spreadsheetId?: string;
        code?: string;
        message?: string;
      }>;
    };
  }> {
    const res = await fetch('/api/admin/settings/spreadsheets/provision', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'SPREADSHEETS_PROVISION_ERROR', err.error?.message || 'No se pudieron crear las planillas');
    }
    return res.json();
  },
};
