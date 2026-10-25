/**
 * Cliente de la API REST de Mautic (OAuth2 client credentials).
 *
 * Porta la semántica de FLACSO_Mautic_Client del plugin de WordPress: upsert de
 * contactos por email con tags que se agregan sin reemplazar, y envío de una
 * plantilla a un contacto con tokens propios de cada entrega. Un 2xx sólo
 * significa que Mautic aceptó la solicitud, no que el correo fue entregado.
 */

export interface MauticCredentials {
  baseUrl: string;
  /** Clave Pública del API client de Mautic. */
  clientId: string;
  /** Clave Secreta del API client de Mautic. */
  clientSecret: string;
}

/**
 * - retryable: no se completó (p. ej. 429/5xx antes de enviar) y puede reintentarse.
 * - unknown: el envío pudo haberse aceptado (timeout, red, 5xx al enviar).
 * - permanent: rechazo comprobado (4xx, configuración inválida).
 */
export type MauticErrorClassification = 'retryable' | 'permanent' | 'unknown';

export class MauticError extends Error {
  constructor(
    message: string,
    public readonly classification: MauticErrorClassification,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'MauticError';
  }
}

export type MauticFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface MauticClientOptions {
  timeoutMs?: number;
  fetch?: MauticFetch;
  now?: () => number;
}

export type MauticContactFields = Record<string, string>;

const TOKEN_REFRESH_MARGIN_MS = 30_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MauticClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: MauticFetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly credentials: MauticCredentials, options: MauticClientOptions = {}) {
    this.baseUrl = credentials.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(this.baseUrl) || !credentials.clientId.trim() || !credentials.clientSecret.trim()) {
      throw new MauticError('La configuración de Mautic está incompleta (URL, Clave Pública o Clave Secreta).', 'permanent');
    }
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  /** Prueba de conexión: obtiene un token y lista un contacto. */
  async verify(): Promise<void> {
    await this.request('GET', '/api/contacts?limit=1');
  }

  async findContactIdByEmail(email: string): Promise<number | null> {
    const normalized = normalizeEmail(email);
    const data = await this.request('GET', `/api/contacts?search=${encodeURIComponent(`email:${normalized}`)}&limit=5`);
    const contacts = data?.contacts && typeof data.contacts === 'object' ? Object.values(data.contacts) : [];
    // La búsqueda de Mautic no es estrictamente exacta: confirmar el email.
    for (const contact of contacts as any[]) {
      const contactEmail = String(contact?.fields?.all?.email ?? '').trim().toLowerCase();
      const id = Number(contact?.id);
      if (contactEmail === normalized && Number.isInteger(id) && id > 0) return id;
    }
    return null;
  }

  /** Crea o actualiza el contacto. Los tags se agregan; nunca se quitan los existentes. */
  async upsertContact(email: string, fields: MauticContactFields = {}, tags: string[] = []): Promise<number> {
    const normalized = normalizeEmail(email);
    const body: Record<string, unknown> = { ...fields, email: normalized };
    if (tags.length > 0) body.tags = [...new Set(tags)];

    const existingId = await this.findContactIdByEmail(normalized);
    const data = existingId
      ? await this.request('PATCH', `/api/contacts/${existingId}/edit`, body)
      : await this.request('POST', '/api/contacts/new', body);
    const id = Number(data?.contact?.id ?? existingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new MauticError('Mautic no devolvió el ID del contacto.', 'unknown');
    }
    return id;
  }

  /** Envía una plantilla de Mautic a un contacto con tokens propios de esta entrega ({token} → valor). */
  async sendTemplateEmail(emailId: number, contactId: number, tokens: Record<string, string>): Promise<void> {
    if (!Number.isInteger(emailId) || emailId <= 0 || !Number.isInteger(contactId) || contactId <= 0) {
      throw new MauticError('El ID de plantilla y el ID de contacto de Mautic deben ser enteros positivos.', 'permanent');
    }
    let data: any;
    try {
      data = await this.request('POST', `/api/emails/${emailId}/contact/${contactId}/send`, { tokens });
    } catch (error) {
      // Una falla del servidor o de red durante el envío puede haber despachado el correo.
      if (error instanceof MauticError && error.classification === 'retryable') {
        throw new MauticError(error.message, 'unknown', error.httpStatus);
      }
      throw error;
    }
    if (data?.success !== true) {
      throw new MauticError(
        'Mautic no confirmó el envío del correo.',
        data?.success === false ? 'permanent' : 'unknown',
      );
    }
  }

  private async request(method: string, path: string, body?: unknown, retriedAuth = false): Promise<any> {
    const token = await this.getAccessToken();
    const response = await this.send(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && !retriedAuth) {
      this.token = null;
      return this.request(method, path, body, true);
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new MauticError(
        `Mautic respondió HTTP ${response.status}: ${extractErrorMessage(data)}`,
        response.status === 429 || response.status >= 500 ? 'retryable' : 'permanent',
        response.status,
      );
    }
    return data;
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + TOKEN_REFRESH_MARGIN_MS) {
      return this.token.value;
    }

    const response = await this.send(`${this.baseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.credentials.clientId.trim(),
        client_secret: this.credentials.clientSecret.trim(),
      }).toString(),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.access_token !== 'string' || !data.access_token) {
      const detail = data?.error_description ?? data?.error ?? `HTTP ${response.status}`;
      throw new MauticError(
        `OAuth2 Mautic: no se pudo obtener el token (${detail}).`,
        response.status >= 500 ? 'retryable' : 'permanent',
        response.status,
      );
    }

    const expiresInMs = Math.max(0, Number(data.expires_in ?? 3600)) * 1000;
    this.token = { value: data.access_token, expiresAt: this.now() + expiresInMs };
    return this.token.value;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new MauticError(
        timedOut ? 'Mautic no respondió a tiempo.' : 'No se pudo conectar con Mautic.',
        'retryable',
      );
    }
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new MauticError('Correo de contacto inválido para Mautic.', 'permanent');
  }
  return normalized;
}

function extractErrorMessage(data: any): string {
  const first = Array.isArray(data?.errors) ? data.errors[0] : data?.error;
  const message = typeof first === 'string' ? first : first?.message;
  return typeof message === 'string' && message ? message.slice(0, 200) : 'error sin detalle';
}
