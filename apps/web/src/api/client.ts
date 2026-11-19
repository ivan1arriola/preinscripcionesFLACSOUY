import type { DiagnosticTarget, FormDefinition, SubmissionFileToken } from '@flacso/contracts';
import { UploadProgressEstimator } from '../domain/upload-progress.js';
import { getUtm } from './utm.js';

const resumableUploads = new WeakMap<File, string>();
const UPLOAD_CHUNK_BYTES = 1024 * 1024;

async function apiError(response: Response, fallback: string): Promise<ApiError> {
  const body = await response.json().catch(() => ({}));
  return new ApiError(response.status, body.error?.code || 'UPLOAD_ERROR', body.error?.message || fallback);
}

function sendUploadChunk(uploadId: string, file: File, offset: number, onBytes: (bytes: number) => void): Promise<void> {
  const end = Math.min(file.size, offset + UPLOAD_CHUNK_BYTES);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PATCH', `/api/uploads/resumable/${encodeURIComponent(uploadId)}`);
    request.setRequestHeader('x-preinscription-session', apiClient.sessionId());
    request.setRequestHeader('Content-Range', `bytes ${offset}-${end - 1}/${file.size}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytes(offset + event.loaded);
    };
    request.onload = () => request.status === 204
      ? resolve()
      : reject(new ApiError(request.status, 'UPLOAD_ERROR', 'No se pudo continuar la carga del archivo.'));
    request.onerror = () => reject(new ApiError(0, 'UPLOAD_ERROR', 'No se pudo cargar el archivo. Revisá tu conexión e intentá de nuevo.'));
    request.onabort = () => reject(new ApiError(0, 'UPLOAD_ABORTED', 'La carga del archivo se canceló.'));
    request.send(file.slice(offset, end));
  });
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly issues?: string[],
    public readonly field?: string,
    public readonly reason?: string,
    public readonly action?: string,
    /** Campos de documentos afectados (FILE_EXPIRED puede traer varios). */
    public readonly fields?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let publicConfig: Promise<PublicConfig> | undefined;

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

  async upload(
    targetId: string,
    fieldKey: string,
    file: File,
    onProgress?: (percent: number, remainingSeconds?: number) => void
  ): Promise<SubmissionFileToken> {
    if (onProgress && typeof XMLHttpRequest !== 'undefined') {
      let uploadId = resumableUploads.get(file);
      let offset = 0;
      if (!uploadId) {
        const response = await fetch('/api/uploads/resumable', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-preinscription-session': apiClient.sessionId() },
          body: JSON.stringify({ targetId, fieldKey, originalName: file.name, mimeType: file.type, size: file.size }),
        });
        if (!response.ok) throw await apiError(response, 'No se pudo iniciar la carga del archivo.');
        const started = await response.json();
        uploadId = started.uploadId as string;
        offset = started.offset;
        resumableUploads.set(file, uploadId);
      } else {
        const response = await fetch(`/api/uploads/resumable/${encodeURIComponent(uploadId)}`, {
          method: 'HEAD', headers: { 'x-preinscription-session': apiClient.sessionId() },
        });
        if (!response.ok) throw await apiError(response, 'No se pudo consultar el avance de la carga.');
        const header = response.headers.get('Upload-Offset');
        offset = header !== null && /^\d+$/.test(header) ? Number(header) : NaN;
        if (!Number.isSafeInteger(offset) || offset > file.size) throw new ApiError(response.status, 'UPLOAD_ERROR', 'No se pudo consultar el avance de la carga.');
      }
      const estimator = new UploadProgressEstimator(file.size);
      const report = (bytes: number) => {
        const progress = estimator.sample(bytes);
        onProgress(progress.percent, progress.remainingSeconds);
      };
      report(offset);
      while (offset < file.size) {
        await sendUploadChunk(uploadId, file, offset, report);
        offset = Math.min(file.size, offset + UPLOAD_CHUNK_BYTES);
        report(offset);
      }
      const completed = await fetch(`/api/uploads/resumable/${encodeURIComponent(uploadId)}/complete`, {
        method: 'POST', headers: { 'x-preinscription-session': apiClient.sessionId() },
      });
      if (!completed.ok) throw await apiError(completed, 'No se pudo completar la carga del archivo.');
      resumableUploads.delete(file);
      onProgress(100, 0);
      return completed.json();
    }
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
    files: SubmissionFileToken[] = [],
    clientSubmissionId?: string,
    recaptchaToken?: string
  ): Promise<{ submissionId: string; status?: string; existing?: boolean }> {
    const res = await fetch(`/api/targets/${encodeURIComponent(id)}/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-preinscription-session': apiClient.sessionId(),
        ...(recaptchaToken ? { 'x-recaptcha-token': recaptchaToken } : {}),
      },
      body: JSON.stringify({ configRevision, values, files, clientSubmissionId, utm: getUtm() }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error?.code || 'SUBMISSION_ERROR',
        err.error?.message || 'Error al procesar la preinscripción',
        err.error?.fieldErrors,
        err.error?.issues,
        err.error?.field,
        undefined,
        undefined,
        Array.isArray(err.error?.fields) ? err.error.fields : undefined
      );
    }

    return res.json();
  },

  /** Avisa que el formulario sigue abierto: renueva el vencimiento de los archivos ya subidos. */
  async keepAlive(): Promise<void> {
    const res = await fetch('/api/uploads/keepalive', {
      method: 'POST',
      headers: { 'x-preinscription-session': apiClient.sessionId() },
    });
    if (!res.ok) throw new Error(`keepalive ${res.status}`);
  },

  async getAdminAuthUrl(redirectUri: string): Promise<{ url: string; state: string }> {
    const res = await fetch(`/api/admin/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`);
    if (!res.ok) throw new ApiError(res.status, 'AUTH_URL_ERROR', 'Error al obtener URL de autenticación');
    return res.json();
  },

  async adminLogin(code: string, redirectUri: string, state: string): Promise<{ user: any; csrfToken: string }> {
    const res = await fetch('/api/admin/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri, state }),
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
        status?: 'reconciled' | 'created' | 'unchanged' | 'blocked' | 'detached';
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
        status: 'reconciled' | 'created' | 'unchanged' | 'blocked' | 'detached';
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

  async unlinkAdminSpreadsheet(targetId: string, csrfToken: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('/api/admin/settings/spreadsheets/unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ targetId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'SPREADSHEET_UNLINK_ERROR', err.error?.message || 'No se pudo desvincular la planilla');
    }
    return res.json();
  },

  async getAdminEmailSettings(): Promise<AdminEmailSettings> {
    const res = await fetch('/api/admin/settings/email');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'EMAIL_SETTINGS_ERROR', err.error?.message || 'Error al obtener configuración de correo');
    }
    return res.json();
  },

  async updateAdminEmailSettings(
    input: UpdateAdminEmailSettingsInput,
    csrfToken: string
  ): Promise<AdminEmailSettings> {
    const res = await fetch('/api/admin/settings/email', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        err.error?.code || 'UPDATE_EMAIL_SETTINGS_ERROR',
        err.error?.message || 'Error al actualizar configuración de correo',
        undefined,
        err.error?.issues?.map((i: any) => (typeof i === 'string' ? i : i.message)),
        err.error?.field,
        err.error?.reason,
        err.error?.action
      );
    }
    return res.json();
  },

  async sendTestAdminEmail(
    recipientEmail: string,
    csrfToken: string
  ): Promise<{ ok: boolean; providerMessageId: string; recipient: string }> {
    const res = await fetch('/api/admin/settings/email/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ recipientEmail }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'SEND_TEST_EMAIL_ERROR', err.error?.message || 'Error al enviar correo de prueba');
    }
    return res.json();
  },

  async verifyAdminEmail(csrfToken: string): Promise<{ ok: boolean }> {
    const res = await fetch('/api/admin/settings/email/verify', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'VERIFY_EMAIL_ERROR', err.error?.message || 'Error al verificar SMTP');
    }
    return res.json();
  },

  async getAdminNotifications(filter?: { status?: string; limit?: number; offset?: number }): Promise<{
    ok: boolean;
    counts: AdminNotificationCounts;
    notifications: AdminNotificationRecord[];
  }> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/admin/settings/notifications${query}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'NOTIFICATIONS_ERROR', err.error?.message || 'Error al consultar notificaciones');
    }
    return res.json();
  },

  async retryAdminNotification(
    id: string,
    csrfToken: string,
    force?: boolean
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/admin/settings/notifications/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'RETRY_NOTIFICATION_ERROR', err.error?.message || 'Error al reintentar notificación');
    }
    return res.json();
  },

  async dispatchAdminNotifications(csrfToken: string): Promise<{
    ok: boolean;
    claimed: number;
    processed: number;
    sent: number;
    failed: number;
    failedPermanent: number;
    failedRetryable: number;
    unknown: number;
  }> {
    const res = await fetch('/api/admin/settings/notifications/dispatch', {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'DISPATCH_ERROR', err.error?.message || 'Error al procesar la cola');
    }
    return res.json();
  },

  async getMauticSettings(): Promise<{ mautic: AdminMauticSettings }> {
    const res = await fetch('/api/admin/settings/mautic');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'MAUTIC_SETTINGS_ERROR', err.error?.message || 'Error al obtener la configuración de Mautic');
    }
    return res.json();
  },

  async updateMauticSettings(
    csrfToken: string,
    input: UpdateAdminMauticSettingsInput
  ): Promise<{ ok: boolean; message: string; mautic: AdminMauticSettings }> {
    const res = await fetch('/api/admin/settings/mautic', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UPDATE_MAUTIC_ERROR', err.error?.message || 'Error al guardar la configuración de Mautic');
    }
    return res.json();
  },

  /** reCAPTCHA y Meta la piden en cada envío y no cambia durante la sesión: una sola petición; si falla, se reintenta. */
  getPublicConfig(): Promise<PublicConfig> {
    publicConfig ??= (async () => {
      const res = await fetch('/api/config');
      if (!res.ok) throw new ApiError(res.status, 'PUBLIC_CONFIG_ERROR', 'No se pudo obtener la configuración pública.');
      return res.json() as Promise<PublicConfig>;
    })().catch((error) => {
      publicConfig = undefined;
      throw error;
    });
    return publicConfig;
  },

  async getRecaptchaSettings(): Promise<{ recaptcha: AdminRecaptchaSettings }> {
    const res = await fetch('/api/admin/settings/recaptcha');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'RECAPTCHA_SETTINGS_ERROR', err.error?.message || 'Error al obtener la configuración de reCAPTCHA');
    }
    return res.json();
  },

  async updateRecaptchaSettings(
    csrfToken: string,
    input: UpdateAdminRecaptchaSettingsInput
  ): Promise<{ ok: boolean; message: string; recaptcha: AdminRecaptchaSettings }> {
    const res = await fetch('/api/admin/settings/recaptcha', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UPDATE_RECAPTCHA_ERROR', err.error?.message || 'Error al guardar la configuración de reCAPTCHA');
    }
    return res.json();
  },

  async testMauticSettings(csrfToken: string): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('/api/admin/settings/mautic/test', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'TEST_MAUTIC_ERROR', err.error?.message || 'No se pudo conectar con Mautic');
    }
    return res.json();
  },

  async getTelegramSettings(): Promise<{ telegram: AdminTelegramSettings }> {
    const res = await fetch('/api/admin/settings/telegram');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'TELEGRAM_SETTINGS_ERROR', err.error?.message || 'Error al obtener configuración de Telegram');
    }
    return res.json();
  },

  async updateTelegramSettings(
    csrfToken: string,
    input: UpdateAdminTelegramSettingsInput
  ): Promise<{ ok: boolean; message: string; telegram: AdminTelegramSettings }> {
    const res = await fetch('/api/admin/settings/telegram', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'UPDATE_TELEGRAM_ERROR', err.error?.message || 'Error al guardar configuración de Telegram');
    }
    return res.json();
  },

  async testTelegramSettings(
    csrfToken: string,
    input?: { chatId?: string }
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch('/api/admin/settings/telegram/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(input ?? {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'TEST_TELEGRAM_ERROR', err.error?.message || 'Error al probar alertas de Telegram');
    }
    return res.json();
  },

  async listRecoveries(params?: {
    status?: string;
    stage?: string;
    targetId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ recoveries: AdminRecoveryRecord[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.stage) query.set('stage', params.stage);
    if (params?.targetId) query.set('targetId', params.targetId);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const qs = query.toString();
    const res = await fetch(`/api/admin/settings/recoveries${qs ? `?${qs}` : ''}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'LIST_RECOVERIES_ERROR', err.error?.message || 'Error al listar preinscripciones para recuperación');
    }
    return res.json();
  },

  async getRecovery(id: string): Promise<{ recovery: AdminRecoveryDetail }> {
    const res = await fetch(`/api/admin/settings/recoveries/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'GET_RECOVERY_ERROR', err.error?.message || 'Error al obtener caso de recuperación');
    }
    return res.json();
  },

  async retryRecovery(
    id: string,
    csrfToken: string
  ): Promise<{ ok: boolean; submissionId: string; message: string }> {
    const res = await fetch(`/api/admin/settings/recoveries/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      headers: {
        'x-csrf-token': csrfToken,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'RETRY_RECOVERY_ERROR', err.error?.message || 'Error al reintentar procesamiento');
    }
    return res.json();
  },

  async discardRecovery(
    id: string,
    csrfToken: string,
    reason?: string
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(`/api/admin/settings/recoveries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(res.status, err.error?.code || 'DISCARD_RECOVERY_ERROR', err.error?.message || 'Error al descartar caso de recuperación');
    }
    return res.json();
  },
};

export interface PublicConfig {
  recaptcha: { enabled: boolean; siteKey?: string; action?: string };
  meta?: { pixelId: string | null };
}

export interface AdminRecaptchaSettings {
  enabled: boolean;
  siteKey: string;
  hasSecretKey: boolean;
  minScore: number;
}

export interface UpdateAdminRecaptchaSettingsInput {
  enabled?: boolean;
  siteKey?: string;
  /** Vacío conserva la clave secreta guardada. */
  secretKey?: string;
  minScore?: number;
}

export interface AdminMauticSettings {
  baseUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  contactsEnabled: boolean;
  applicantTemplateId: number | null;
  teamTemplateId: number | null;
  enrollmentNotifyEnabled: boolean;
  hasEnrollmentSecret: boolean;
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestError?: string | null;
}

export interface UpdateAdminMauticSettingsInput {
  baseUrl?: string;
  clientId?: string;
  /** Vacío conserva la Clave Secreta guardada. */
  clientSecret?: string;
  contactsEnabled?: boolean;
  applicantTemplateId?: number | null;
  teamTemplateId?: number | null;
  enrollmentNotifyEnabled?: boolean;
  /** Vacío conserva el secreto guardado. Mínimo 32 caracteres. */
  enrollmentSecret?: string;
}

export interface AdminTelegramSettings {
  enabled: boolean;
  preinscriptionEnabled: boolean;
  hasToken: boolean;
  chatIdsCount: number;
  maskedChatIds: string[];
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | null;
  lastTestError?: string | null;
  lastAlertSentAt?: string | null;
}

export interface UpdateAdminTelegramSettingsInput {
  enabled?: boolean;
  preinscriptionEnabled?: boolean;
  botToken?: string;
  replaceToken?: boolean;
  chatIds?: string[];
}

export interface AdminRecoveryRecord {
  id: string;
  submissionId: string;
  targetId: string;
  targetTitle: string | null;
  targetKind: string | null;
  stage: 'drive' | 'sheets' | 'notifications' | 'unknown';
  status: 'pending' | 'retrying' | 'resolved' | 'discarded';
  safeError: string;
  attemptCount: number;
  lastAttemptAt: string;
  retentionExpiresAt: string;
  resolvedAt: string | null;
  discardedAt: string | null;
  discardedBy: string | null;
  discardReason: string | null;
  createdAt: string;
  updatedAt: string;
  filesCount: number;
}

export interface AdminRecoveryDetailFile {
  token: string;
  fieldKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  driveFileId?: string | null;
  uploadedAt: string | null;
  status: 'stored_in_drive' | 'pending_in_storage' | 'missing';
}

export interface AdminRecoveryDetail {
  id: string;
  submissionId: string;
  targetId: string;
  targetTitle: string | null;
  targetKind: string | null;
  stage: 'drive' | 'sheets' | 'notifications' | 'unknown';
  status: 'pending' | 'retrying' | 'resolved' | 'discarded';
  safeError: string;
  attemptCount: number;
  lastAttemptAt: string;
  retentionExpiresAt: string;
  resolvedAt: string | null;
  discardedAt: string | null;
  discardedBy: string | null;
  discardReason: string | null;
  createdAt: string;
  updatedAt: string;
  files: AdminRecoveryDetailFile[];
  values?: Record<string, string>;
}

export interface AdminEmailSettings {
  enabled: boolean;
  configured: boolean;
  provider: 'smtp' | 'mautic';
  smtp: {
    host: string;
    port: number;
    security: 'starttls' | 'tls';
    username: string;
    hasPassword: boolean;
    fromEmail: string | null;
    replyToEmail: string | null;
  };
  masterEmails: string[];
  status: {
    lastConnectionTestAt: string | null;
    lastConnectionTestOk: boolean | null;
    lastConnectionTestError: string | null;
  };
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface UpdateAdminEmailSettingsInput {
  enabled?: boolean;
  provider?: 'smtp' | 'mautic';
  masterEmails?: string[];
  host?: string;
  port?: number;
  security?: 'starttls' | 'tls';
  username?: string;
  password?: string;
  replacePassword?: boolean;
  fromEmail?: string;
  replyToEmail?: string | null;
  configurationSet?: string | null;
}

export interface AdminNotificationRecord {
  id: string;
  submissionId: string;
  audience: 'applicant' | 'target' | 'master';
  recipientEmail: string;
  targetId: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'unknown';
  attemptCount: number;
  providerMessageId: string | null;
  lastError: string | null;
  availableAt: string;
  lockedUntil: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNotificationCounts {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  unknown: number;
  total: number;
}
