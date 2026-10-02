import { z } from 'zod';

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
  registrationOpen: z.boolean(),
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

export type WordPressV1Response = z.infer<typeof WordPressV1ResponseSchema>;
export type WordPressTarget = z.infer<typeof WordPressTargetSchema>;

export interface WordPressClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: WordPressClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async getPreinscriptions(): Promise<WordPressV1Response> {
    const url = `${this.baseUrl}/wp-json/flacso/v1/preinscripciones`;
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

    const parseResult = WordPressV1ResponseSchema.safeParse(payload);
    if (!parseResult.success) {
      const issueDetails = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new WordPressClientError(
        `Respuesta de WordPress incompatible con el contrato v1: ${issueDetails}`
      );
    }

    return parseResult.data;
  }
}
