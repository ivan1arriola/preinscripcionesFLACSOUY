import type { DiagnosticTarget, FormDefinition } from '@flacso/contracts';

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
    values: Record<string, string>
  ): Promise<{ submissionId: string }> {
    const res = await fetch(`/api/targets/${encodeURIComponent(id)}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configRevision, values }),
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

  // Admin API methods
  getAdminToken(): string | null {
    return localStorage.getItem('flacso_admin_token');
  },

  setAdminToken(token: string | null) {
    if (token) {
      localStorage.setItem('flacso_admin_token', token);
    } else {
      localStorage.removeItem('flacso_admin_token');
    }
  },

  async adminLogin(username: string, password: string): Promise<{ token: string; user: { username: string } }> {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error || 'AUTH_ERROR',
        err.message || 'Credenciales de administrador inválidas'
      );
    }

    const data = await res.json();
    this.setAdminToken(data.token);
    return data;
  },

  async adminLogout(): Promise<void> {
    const token = this.getAdminToken();
    this.setAdminToken(null);
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
  },

  async getAdminMe(): Promise<{ authenticated: boolean; user: { username: string } }> {
    const token = this.getAdminToken();
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'No hay sesión de administrador');

    const res = await fetch('/api/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      this.setAdminToken(null);
      throw new ApiError(res.status, 'UNAUTHORIZED', 'Sesión expirada');
    }

    return res.json();
  },

  async getAdminTargets(): Promise<DiagnosticTarget[]> {
    const token = this.getAdminToken();
    const res = await fetch('/api/admin/targets', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error || 'ERROR', err.message || 'Error al obtener targets');
    }

    return res.json();
  },

  async getAdminTargetDiagnostics(targetId: string): Promise<any> {
    const token = this.getAdminToken();
    const res = await fetch(`/api/admin/targets/${encodeURIComponent(targetId)}/diagnostics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error || 'ERROR', err.message || 'Error al diagnosticar target');
    }

    return res.json();
  },

  async getAdminErrors(filter?: { status?: string; origin?: string }): Promise<any[]> {
    const token = this.getAdminToken();
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.origin) params.set('origin', filter.origin);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/admin/errors${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error || 'ERROR', err.message || 'Error al obtener errores');
    }

    return res.json();
  },

  async resolveAdminError(errorId: string): Promise<any> {
    const token = this.getAdminToken();
    const res = await fetch(`/api/admin/errors/${encodeURIComponent(errorId)}/resolve`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error || 'ERROR', err.message || 'Error al resolver error');
    }

    return res.json();
  },

  async getAdminHealth(): Promise<any> {
    const token = this.getAdminToken();
    const res = await fetch('/api/admin/health/integrations', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error || 'ERROR', err.message || 'Error al verificar salud');
    }

    return res.json();
  },
};
