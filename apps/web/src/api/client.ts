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

};
