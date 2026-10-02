import { z } from 'zod';

export class WordPressClientError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'WordPressClientError';
  }
}

export const TargetInputSchema = z.object({
  key: z.string(),
  position: z.number(),
  required: z.boolean(),
});

export const FormStateSchema = z.object({
  valid: z.boolean(),
  inputs: z.array(TargetInputSchema),
  issues: z.array(z.string()).optional(),
});

export const OrientationMentionSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const OrientationSchema = z.object({
  id: z.string(),
  name: z.string(),
  mentions: z.array(OrientationMentionSchema),
});

export const TargetUrlsSchema = z.object({
  public: z.string().nullable().optional(),
  wordpress: z.string().nullable().optional(),
  edit: z.string().nullable().optional(),
  legacyRegistration: z.string().nullable().optional(),
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
  form: FormStateSchema,
  orientations: z.array(OrientationSchema),
  urls: TargetUrlsSchema,
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
    } catch (err) {
      throw new WordPressClientError(
        `Error al conectar con WordPress en ${this.baseUrl}: ${err instanceof Error ? err.message : 'timeout o fallo de red'}`
      );
    }

    if (!response.ok) {
      throw new WordPressClientError(
        `WordPress devolvió un estado HTTP no exitoso: ${response.status}`,
        response.status
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new WordPressClientError('WordPress no devolvió una respuesta JSON válida');
    }

    const parseResult = WordPressV1ResponseSchema.safeParse(json);
    if (!parseResult.success) {
      const issueDetails = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new WordPressClientError(
        `Respuesta de WordPress incompatible con el contrato v1: ${issueDetails}`
      );
    }

    return parseResult.data;
  }
}
