import { z } from 'zod';

export const SUPPORTED_OFFER_TYPES = [
  'maestria',
  'especializacion',
  'diplomado',
  'diploma',
  'seminar',
] as const;

export type SupportedOfferType = (typeof SUPPORTED_OFFER_TYPES)[number];

export function isSupportedOfferType(type: string): type is SupportedOfferType {
  return (SUPPORTED_OFFER_TYPES as readonly string[]).includes(type);
}

export const FormStepDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().positive(),
  description: z.string().optional(),
});

export type FormStepDefinition = z.infer<typeof FormStepDefinitionSchema>;

export const FieldRuleDefinitionSchema = z.object({
  key: z.string().min(1),
  stepId: z.string().min(1),
  order: z.number().int().positive(),
  label: z.string().optional(),
  required: z.boolean(),
  condition: z.enum(['always', 'has_orientations', 'has_mentions']).default('always'),
});

export type FieldRuleDefinition = z.infer<typeof FieldRuleDefinitionSchema>;

export const DocumentRuleDefinitionSchema = z.object({
  key: z.string().min(1),
  stepId: z.string().min(1),
  order: z.number().int().positive(),
  label: z.string().optional(),
  required: z.boolean(),
  canDefer: z.boolean().default(false),
  maxFiles: z.number().int().positive().default(1),
  maxBytes: z.number().int().positive().optional(),
  acceptedMimeTypes: z.array(z.string()).optional(),
});

export type DocumentRuleDefinition = z.infer<typeof DocumentRuleDefinitionSchema>;

export const FormProfileDefinitionSchema = z.object({
  steps: z.array(FormStepDefinitionSchema).min(1),
  fields: z.array(FieldRuleDefinitionSchema),
  documents: z.array(DocumentRuleDefinitionSchema),
  recommendationLettersCount: z.number().int().nonnegative().optional(),
});

export type FormProfileDefinition = z.infer<typeof FormProfileDefinitionSchema>;

export interface FormProfile {
  id: string;
  type: SupportedOfferType;
  name: string;
  activeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FormProfileVersion {
  id: string;
  profileId: string;
  versionNumber: number;
  definition: FormProfileDefinition;
  createdBy: string;
  createdAt: Date;
}

export interface EffectiveProfile {
  profileId: string;
  type: SupportedOfferType;
  name: string;
  versionId: string;
  versionNumber: number;
  definition: FormProfileDefinition;
}

export interface AdminUser {
  id: string;
  googleSubject: string;
  email: string;
  name: string;
  pictureUrl?: string;
  role: 'admin';
  createdAt: Date;
  lastLoginAt?: Date;
}

export function validateProfileDefinition(
  type: SupportedOfferType,
  raw: unknown,
): FormProfileDefinition {
  const parsed = FormProfileDefinitionSchema.parse(raw);

  const stepIds = new Set<string>();
  const stepOrders = new Set<number>();
  for (const step of parsed.steps) {
    if (stepIds.has(step.id)) {
      throw new Error(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);
    if (stepOrders.has(step.order)) {
      throw new Error(`Duplicate step order: ${step.order}`);
    }
    stepOrders.add(step.order);
  }

  const fieldKeys = new Set<string>();
  for (const field of parsed.fields) {
    if (fieldKeys.has(field.key)) {
      throw new Error(`Duplicate field key: ${field.key}`);
    }
    fieldKeys.add(field.key);

    if (!stepIds.has(field.stepId)) {
      throw new Error(`Field ${field.key} references non-existent step: ${field.stepId}`);
    }

    if (type === 'seminar') {
      if (
        field.key === 'orientacion' ||
        field.key === 'mencion' ||
        field.condition === 'has_orientations' ||
        field.condition === 'has_mentions'
      ) {
        throw new Error(
          `Seminar profiles cannot contain orientation or mention rules: field ${field.key}`,
        );
      }
    }
  }

  const docKeys = new Set<string>();
  for (const doc of parsed.documents) {
    if (docKeys.has(doc.key)) {
      throw new Error(`Duplicate document key: ${doc.key}`);
    }
    docKeys.add(doc.key);

    if (!stepIds.has(doc.stepId)) {
      throw new Error(`Document ${doc.key} references non-existent step: ${doc.stepId}`);
    }
  }

  return parsed;
}

export function getDefaultProfileDefinition(type: SupportedOfferType): FormProfileDefinition {
  if (!isSupportedOfferType(type)) {
    throw new Error(`Unsupported profile type: ${type}`);
  }

  const isSeminar = type === 'seminar';

  const steps: FormStepDefinition[] = isSeminar
    ? [
        { id: 'personal', title: 'Datos personales y demográficos', order: 1 },
        { id: 'contacto', title: 'Residencia y contacto', order: 2 },
        { id: 'academico', title: 'Trayectoria académica', order: 3 },
        { id: 'declaracion', title: 'Convenios y declaraciones', order: 4 },
      ]
    : [
        { id: 'personal', title: 'Datos personales y demográficos', order: 1 },
        { id: 'contacto', title: 'Residencia y contacto', order: 2 },
        { id: 'academico', title: 'Trayectoria académica', order: 3 },
        { id: 'documentos', title: 'Documentación requerida', order: 4 },
        { id: 'declaracion', title: 'Convenios y declaraciones', order: 5 },
      ];

  const personalFields: FieldRuleDefinition[] = [
    { key: 'nombre1', stepId: 'personal', order: 1, required: true, condition: 'always' },
    { key: 'nombre2', stepId: 'personal', order: 2, required: false, condition: 'always' },
    { key: 'apellido1', stepId: 'personal', order: 3, required: true, condition: 'always' },
    { key: 'apellido2', stepId: 'personal', order: 4, required: false, condition: 'always' },
    { key: 'fechaNacimiento', stepId: 'personal', order: 5, required: true, condition: 'always' },
    { key: 'tipoDocumento', stepId: 'personal', order: 6, required: true, condition: 'always' },
    { key: 'documento', stepId: 'personal', order: 7, required: true, condition: 'always' },
    { key: 'paisEmisorDocumento', stepId: 'personal', order: 8, required: true, condition: 'always' },
    { key: 'genero', stepId: 'personal', order: 9, required: true, condition: 'always' },
    { key: 'generoOtra', stepId: 'personal', order: 10, required: false, condition: 'always' },
    { key: 'etnia', stepId: 'personal', order: 11, required: true, condition: 'always' },
    { key: 'paisNacimiento', stepId: 'personal', order: 12, required: true, condition: 'always' },
  ];

  const contactoFields: FieldRuleDefinition[] = [
    { key: 'paisResidencia', stepId: 'contacto', order: 13, required: true, condition: 'always' },
    { key: 'domicilio', stepId: 'contacto', order: 14, required: true, condition: 'always' },
    { key: 'celular', stepId: 'contacto', order: 15, required: true, condition: 'always' },
    { key: 'email', stepId: 'contacto', order: 16, required: true, condition: 'always' },
    { key: 'ocupacion', stepId: 'contacto', order: 17, required: true, condition: 'always' },
  ];

  const academicoFields: FieldRuleDefinition[] = [
    { key: 'estudios', stepId: 'academico', order: 18, required: true, condition: 'always' },
    { key: 'posgradoFlacso', stepId: 'academico', order: 19, required: true, condition: 'always' },
    { key: 'posgradoCual', stepId: 'academico', order: 20, required: false, condition: 'always' },
  ];

  if (!isSeminar) {
    academicoFields.push(
      { key: 'titulo', stepId: 'academico', order: 21, required: true, condition: 'always' },
      { key: 'escolaridad', stepId: 'academico', order: 22, required: true, condition: 'always' },
      { key: 'institucion', stepId: 'academico', order: 23, required: false, condition: 'always' },
      { key: 'orientacion', stepId: 'academico', order: 24, required: true, condition: 'has_orientations' },
      { key: 'mencion', stepId: 'academico', order: 25, required: false, condition: 'has_mentions' },
    );
  }

  const declaracionFields: FieldRuleDefinition[] = [
    { key: 'tieneConvenio', stepId: 'declaracion', order: 26, required: true, condition: 'always' },
    { key: 'convenioWordpressId', stepId: 'declaracion', order: 27, required: false, condition: 'always' },
    { key: 'fuente', stepId: 'declaracion', order: 28, required: true, condition: 'always' },
    { key: 'aceptaDifusion', stepId: 'declaracion', order: 29, required: true, condition: 'always' },
  ];

  const fields = [...personalFields, ...contactoFields, ...academicoFields, ...declaracionFields];

  const documents: DocumentRuleDefinition[] = [];

  if (isSeminar) {
    // Seminars do not require formal degrees or letters by default
  } else {
    // Common required documents for academic offers: identidad, cv, titulo
    documents.push(
      {
        key: 'identidad',
        stepId: 'documentos',
        order: 1,
        label: 'Documento de identidad',
        required: true,
        canDefer: false,
        maxFiles: 2,
        maxBytes: 10 * 1024 * 1024,
        acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      },
      {
        key: 'cv',
        stepId: 'documentos',
        order: 2,
        label: 'Curriculum Vitae',
        required: true,
        canDefer: false,
        maxFiles: 1,
        maxBytes: 10 * 1024 * 1024,
        acceptedMimeTypes: ['application/pdf'],
      },
      {
        key: 'titulo',
        stepId: 'documentos',
        order: 3,
        label: 'Título',
        required: true,
        canDefer: false,
        maxFiles: 1,
        maxBytes: 10 * 1024 * 1024,
        acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      },
    );

    if (type === 'maestria' || type === 'especializacion' || type === 'diplomado') {
      documents.push({
        key: 'cartaMotivacion',
        stepId: 'documentos',
        order: 4,
        label: 'Carta de motivación',
        required: true,
        canDefer: true,
        maxFiles: 1,
        maxBytes: 10 * 1024 * 1024,
        acceptedMimeTypes: ['application/pdf'],
      });
    }

    if (type === 'maestria') {
      documents.push(
        {
          key: 'cartaRecomendacion1',
          stepId: 'documentos',
          order: 5,
          label: 'Primera carta de recomendación',
          required: false,
          canDefer: true,
          maxFiles: 1,
          maxBytes: 10 * 1024 * 1024,
          acceptedMimeTypes: ['application/pdf'],
        },
        {
          key: 'cartaRecomendacion2',
          stepId: 'documentos',
          order: 6,
          label: 'Segunda carta de recomendación',
          required: false,
          canDefer: true,
          maxFiles: 1,
          maxBytes: 10 * 1024 * 1024,
          acceptedMimeTypes: ['application/pdf'],
        },
      );
    }
  }

  const recommendationLettersCount = type === 'maestria' ? 2 : 0;

  return {
    steps,
    fields,
    documents,
    recommendationLettersCount,
  };
}
