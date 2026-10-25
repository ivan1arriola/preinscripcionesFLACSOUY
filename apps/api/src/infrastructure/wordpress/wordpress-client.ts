import { z } from 'zod';
import { decodeHtmlEntities } from './html-entities.js';

export class WordPressClientError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'WordPressClientError';
  }
}

export const TargetUrlsSchema = z.object({
  public: z.string().nullable().optional(),
  wordpress: z.string().nullable().optional(),
  edit: z.string().nullable().optional(),
  legacyRegistration: z.string().nullable().optional(),
});

export const WordPressOfferSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  type: z.string().min(1),
  orientations: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional(),
});

export const WordPressSeminarSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  type: z.literal('seminar'),
});

export const WordPressTargetSchema = z.object({
  id: z.string(),
  kind: z.enum(['academic_offer', 'seminar']),
  title: z.string(),
  // Sin .email(): normalizeNotificationEmails descarta direcciones inválidas sin invalidar el target.
  notificationEmail: z.string().nullable().optional(),
  notificationEmails: z.array(z.string()).optional(),
  registrationOpen: z.boolean(),
  registrationAvailability: z.enum(['open', 'closed', 'conflict']).optional(),
  registrationWindow: z.object({
    from: z.string().nullable().optional(),
    until: z.string().nullable().optional(),
  }),
  configRevision: z.string(),
  wordpress: z.object({
    offerId: z.number().optional(),
    cohortId: z.number().optional(),
    seminarId: z.number().optional(),
    editionId: z.number().optional(),
  }).optional(),
  offer: WordPressOfferSchema.optional(),
  seminar: WordPressSeminarSchema.optional(),
  cohort: z.object({
    number: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
  }).optional(),
  edition: z.object({
    number: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
  }).optional(),
  orientations: z.array(z.string()),
  mentions: z.array(z.string()).optional(),
  urls: TargetUrlsSchema,
}).superRefine((val, ctx) => {
  if (val.kind === 'academic_offer') {
    if (!val.offer || !val.offer.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Academic offer targets must provide offer.type',
        path: ['offer', 'type'],
      });
    }
  }
});

export const WordPressV1ResponseSchema = z.object({
  version: z.literal(1),
  targets: z.array(WordPressTargetSchema),
});

/** Sobre del contrato: cada target se valida por separado para que uno inválido no tire el catálogo. */
const WordPressV1EnvelopeSchema = z.object({
  version: z.literal(1),
  targets: z.array(z.unknown()),
});

export interface RejectedWordPressTarget {
  id: string;
  issues: string[];
}

export type WordPressV1Response = z.infer<typeof WordPressV1ResponseSchema> & {
  rejectedTargets?: RejectedWordPressTarget[];
};
export type WordPressTarget = z.infer<typeof WordPressTargetSchema>;

export interface WordPressClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  /**
   * Token del portal (FLACSO_PREINSCRIPCIONES_CATALOG_TOKEN en WordPress). Sin él,
   * WordPress entrega el catálogo público, que no incluye los correos de notificación.
   */
  catalogToken?: string;
}

const WordPressAgreementSchema = z.object({
  id: z.number().int().positive(),
  title: z.object({ rendered: z.string() }),
});

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly catalogToken?: string;

  constructor(options: WordPressClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.catalogToken = options.catalogToken?.trim() || undefined;
  }

  async getPreinscriptions(): Promise<WordPressV1Response> {
    const url = `${this.baseUrl}/wp-json/flacso/v1/preinscripciones`;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: this.catalogToken
          ? { Accept: 'application/json', Authorization: `Bearer ${this.catalogToken}` }
          : { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: any) {
      throw new WordPressClientError(`No se pudo conectar con WordPress: ${err.message}`);
    }

    if (!response.ok) {
      throw new WordPressClientError(
        `Error HTTP ${response.status} al consultar WordPress`,
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WordPressClientError('Respuesta de WordPress no es un JSON válido');
    }

    const envelope = WordPressV1EnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      const issueDetails = envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new WordPressClientError(
        `Respuesta de WordPress incompatible con el contrato v1: ${issueDetails}`
      );
    }

    const targets: WordPressTarget[] = [];
    const rejectedTargets: RejectedWordPressTarget[] = [];
    envelope.data.targets.forEach((rawTarget, index) => {
      const parsed = WordPressTargetSchema.safeParse(rawTarget);
      if (parsed.success) {
        targets.push(parsed.data);
        return;
      }
      const rawId = (rawTarget as { id?: unknown } | null)?.id;
      rejectedTargets.push({
        id: typeof rawId === 'string' ? rawId : `#${index}`,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    });

    if (rejectedTargets.length > 0) {
      // Sólo id y rutas del error: nunca valores, que pueden incluir correos.
      console.warn(
        `[Catalog] ${rejectedTargets.length} destino(s) de WordPress descartado(s) por no cumplir el contrato v1:`,
        rejectedTargets.map((r) => `${r.id} (${r.issues.map((issue) => issue.split(':')[0]).join(', ')})`).join('; ')
      );
    }

    return rejectedTargets.length > 0
      ? { version: envelope.data.version, targets, rejectedTargets }
      : { version: envelope.data.version, targets };
  }

  async getAgreements(): Promise<Array<{ id: string; label: string }>> {
    const url = `${this.baseUrl}/wp-json/wp/v2/convenio?per_page=100&_fields=id,title`;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: any) {
      throw new WordPressClientError(`No se pudo conectar con WordPress: ${err.message}`);
    }

    if (!response.ok) {
      throw new WordPressClientError(`Error HTTP ${response.status} al consultar los convenios de WordPress`, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WordPressClientError('La respuesta de convenios de WordPress no es un JSON válido');
    }

    const parsed = z.array(WordPressAgreementSchema).safeParse(payload);
    if (!parsed.success) {
      throw new WordPressClientError('La respuesta de convenios de WordPress no cumple el formato esperado');
    }

    return parsed.data
      .map((agreement) => ({ id: String(agreement.id), label: decodeHtmlEntities(agreement.title.rendered).trim() }))
      .filter((agreement) => agreement.label.length > 0);
  }
}
