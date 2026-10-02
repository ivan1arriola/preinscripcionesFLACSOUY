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

};
