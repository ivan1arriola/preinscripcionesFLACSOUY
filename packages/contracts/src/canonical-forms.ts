import type {
  AcademicTarget,
  AgreementOption,
  DocumentDefinition,
  FormDefinition,
  FormStepDefinition,
  InputDefinition,
} from './catalog.js';

export const CANONICAL_SCHEMA_VERSION = 'canonical-v2';

export const CANONICAL_STEPS: FormStepDefinition[] = [
  { id: 'personal', title: 'Datos personales y demográficos', order: 1 },
  { id: 'contacto', title: 'Residencia y contacto', order: 2 },
  { id: 'academico', title: 'Trayectoria académica', order: 3 },
  { id: 'orientacion', title: 'Orientación y mención', order: 4 },
  { id: 'documentos', title: 'Documentación requerida', order: 5 },
  { id: 'declaracion', title: 'Convenios y declaraciones', order: 6 },
];

export const CANONICAL_BASE_INPUTS: Array<Omit<InputDefinition, 'position'>> = [
  // Step 1: Datos personales y demográficos
  { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'Primer nombre' },
  { key: 'nombre2', label: 'Segundo nombre', type: 'text', required: false, stepId: 'personal', spreadsheetColumn: 'Segundo nombre' },
  { key: 'apellido1', label: 'Primer apellido', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'Primer apellido' },
  { key: 'apellido2', label: 'Segundo apellido', type: 'text', required: false, stepId: 'personal', spreadsheetColumn: 'Segundo apellido' },
  { key: 'fechaNacimiento', label: 'Fecha de nacimiento', type: 'date', required: true, stepId: 'personal', spreadsheetColumn: 'Fecha de nacimiento' },
  { key: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, stepId: 'personal', spreadsheetColumn: 'Tipo de documento' },
  { key: 'paisEmisorDocumento', label: 'País emisor del documento', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'País emisor del documento' },
  { key: 'documento', label: 'Número de documento', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'Número de documento' },
  { key: 'genero', label: 'Identidad de género', type: 'select', required: true, stepId: 'personal', spreadsheetColumn: 'Identidad de género' },
  { key: 'generoOtra', label: 'Especifique su identidad de género', type: 'text', required: false, stepId: 'personal', spreadsheetColumn: 'Especificación de identidad de género' },
  { key: 'etnia', label: 'Raza / etnia', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'Raza / etnia' },
  { key: 'paisNacimiento', label: 'País de nacimiento', type: 'text', required: true, stepId: 'personal', spreadsheetColumn: 'País de nacimiento' },

  // Step 2: Residencia y contacto
  { key: 'paisResidencia', label: 'País de residencia', type: 'text', required: true, stepId: 'contacto', spreadsheetColumn: 'País de residencia' },
  { key: 'ciudadResidencia', label: 'Ciudad de residencia', type: 'text', required: true, stepId: 'contacto', spreadsheetColumn: 'Ciudad de residencia' },
  { key: 'celular', label: 'Celular', type: 'tel', required: true, stepId: 'contacto', spreadsheetColumn: 'Celular' },
  { key: 'email', label: 'Correo electrónico', type: 'email', required: true, stepId: 'contacto', spreadsheetColumn: 'Correo electrónico' },
  { key: 'ocupacion', label: 'Ocupación actual', type: 'text', required: true, stepId: 'contacto', spreadsheetColumn: 'Ocupación actual' },

  // Step 3: Trayectoria académica
  { key: 'estudios', label: 'Estudios cursados', type: 'textarea', required: true, stepId: 'academico', spreadsheetColumn: 'Estudios cursados' },
  { key: 'posgradoFlacso', label: '¿Cursaste algún posgrado en FLACSO?', type: 'select', required: true, stepId: 'academico', spreadsheetColumn: '¿Cursó posgrado en FLACSO?' },
  { key: 'posgradoCual', label: '¿Cuál posgrado?', type: 'text', required: false, stepId: 'academico', spreadsheetColumn: 'Cuál posgrado' },

  // Title companion fields are rendered with the title document in Trayectoria académica.
  { key: 'tituloDenominacion', label: 'Denominación del título', type: 'text', required: false, stepId: 'academico', spreadsheetColumn: 'Denominación del título' },
  { key: 'sinTituloActual', label: 'No poseo actualmente título', type: 'checkbox', required: false, stepId: 'academico', spreadsheetColumn: 'No posee actualmente título' },

  // Step 5: Convenios y declaraciones
  { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, stepId: 'declaracion', spreadsheetColumn: '¿Te corresponde algún convenio?' },
  { key: 'convenioWordpressId', label: '¿Cuál convenio te corresponde?', type: 'text', required: false, stepId: 'declaracion', spreadsheetColumn: 'Convenio' },
  { key: 'fuente', label: '¿Cómo conociste esta propuesta?', type: 'select', required: true, stepId: 'declaracion', spreadsheetColumn: 'Cómo conociste la propuesta' },
  { key: 'aceptaDifusion', label: '¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?', type: 'select', required: true, stepId: 'declaracion', spreadsheetColumn: 'Autoriza difusión' },
  { key: 'aceptaComunicaciones', label: '¿Querés recibir novedades y propuestas académicas de FLACSO Uruguay por correo?', type: 'select', required: true, stepId: 'declaracion', spreadsheetColumn: 'Acepta comunicaciones' },
];

/** Todo documento admite PDF o una imagen (foto o escaneo): JPG, PNG o WebP. */
export const DOCUMENT_MIME_TYPES: string[] = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const CANONICAL_CORE_DOCUMENTS: DocumentDefinition[] = [
  {
    key: 'identidad',
    label: 'Documento de identidad',
    required: true,
    canDefer: false,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    stepId: 'documentos',
    position: 1,
  },
  {
    key: 'cv',
    label: 'Curriculum Vitae',
    required: true,
    canDefer: false,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    stepId: 'documentos',
    position: 2,
  },
  {
    key: 'titulo',
    label: 'Título de grado o terciario',
    required: true,
    canDefer: false,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    stepId: 'academico',
    position: 3,
    companionInputKey: 'tituloDenominacion',
    alternative: {
      kind: 'absence',
      valueKey: 'sinTituloActual',
      activeValue: 'Si',
      label: 'No poseo actualmente título',
    },
  },
];

export const MOTIVATION_DOCUMENT: DocumentDefinition = {
  key: 'cartaMotivacion',
  label: 'Carta de motivación',
  required: true,
  canDefer: false,
  maxFiles: 2,
  maxBytes: 10 * 1024 * 1024,
  acceptedMimeTypes: DOCUMENT_MIME_TYPES,
  stepId: 'documentos',
  position: 4,
};

export const CANONICAL_BASE_DOCUMENTS: DocumentDefinition[] = [
  ...CANONICAL_CORE_DOCUMENTS,
  MOTIVATION_DOCUMENT,
];

export const MAESTRIA_EXTRA_DOCUMENTS: DocumentDefinition[] = [
  {
    key: 'cartaRecomendacion1',
    label: 'Primera carta de recomendación',
    required: true,
    canDefer: false,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    stepId: 'documentos',
    position: 5,
  },
  {
    key: 'cartaRecomendacion2',
    label: 'Segunda carta de recomendación',
    required: true,
    canDefer: false,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    stepId: 'documentos',
    position: 6,
  },
];

export const SUPPORTED_CANONICAL_OFFER_TYPES = new Set([
  'maestria',
  'especializacion',
  'diplomado',
  'diploma',
  'seminar',
]);

export type CanonicalCompositionResult =
  | { ok: true; value: FormDefinition }
  | { ok: false; error: { code: string; message: string; issues: string[] } };

export function getCanonicalFormDefinition(
  target: AcademicTarget,
  agreements: AgreementOption[] = [],
): CanonicalCompositionResult {
  const offerType = target.kind === 'seminar'
    ? 'seminar'
    : target.offer?.type || target.offerType || '';

  if (offerType === 'doctorado') {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OFFER_TYPE',
        message: 'Doctorados no están soportados actualmente.',
        issues: ['unsupported_offer_type: doctorado'],
      },
    };
  }

  if (offerType && !SUPPORTED_CANONICAL_OFFER_TYPES.has(offerType)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OFFER_TYPE',
        message: `Tipo de oferta no soportado: ${offerType}`,
        issues: [`unsupported_offer_type: ${offerType}`],
      },
    };
  }

  // Compose inputs with positions
  const targetOrientations = target.orientations ?? [];
  const targetMentions = target.mentions ?? [];

  const inputs: InputDefinition[] = [];
  let position = 1;

  for (const base of CANONICAL_BASE_INPUTS) {
    // Insert orientacion & mencion at the end of academico step if options exist
    if (base.stepId === 'declaracion' && inputs.every((i) => i.key !== 'orientacion') && targetOrientations.length > 0) {
      inputs.push({
        key: 'orientacion',
        label: 'Orientación',
        type: 'select',
        required: true,
        position: position++,
        stepId: 'orientacion',
        optionsSource: 'wordpress.orientaciones',
        condition: 'has_orientations',
        spreadsheetColumn: 'Orientación',
      });
    }

    if (base.stepId === 'declaracion' && inputs.every((i) => i.key !== 'mencion') && targetMentions.length > 0) {
      inputs.push({
        key: 'mencion',
        label: 'Mención',
        type: 'select',
        required: false,
        position: position++,
        stepId: 'orientacion',
        optionsSource: 'wordpress.menciones',
        condition: 'has_mentions',
        spreadsheetColumn: 'Mención',
      });
    }

    inputs.push({
      ...base,
      position: position++,
    });
  }

  // Compose documents
  const isSeminar = target.kind === 'seminar' || offerType === 'seminar';
  const isMaestria = offerType === 'maestria';
  const rawDocuments: DocumentDefinition[] = isSeminar
    ? [...CANONICAL_CORE_DOCUMENTS]
    : isMaestria
    ? [...CANONICAL_BASE_DOCUMENTS, ...MAESTRIA_EXTRA_DOCUMENTS]
    : [...CANONICAL_BASE_DOCUMENTS];

  const documents: DocumentDefinition[] = rawDocuments.map((doc, idx) => ({
    ...doc,
    position: idx + 1,
  }));
  const steps = CANONICAL_STEPS.filter(
    (step) => step.id !== 'orientacion' || targetOrientations.length > 0 || targetMentions.length > 0,
  );

  return {
    ok: true,
    value: {
      targetId: target.id,
      kind: target.kind,
      title: target.title,
      offerType: offerType || 'diploma',
      profileVersionId: CANONICAL_SCHEMA_VERSION,
      effectiveRevision: `${target.configRevision}:${CANONICAL_SCHEMA_VERSION}`,
      registrationOpen: target.registrationOpen,
      configRevision: target.configRevision,
      steps,
      inputs,
      documents,
      orientations: targetOrientations,
      mentions: targetMentions,
      agreements,
      recommendationLettersCount: isMaestria ? 2 : 0,
    },
  };
}
