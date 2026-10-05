import type {
  FormDefinition,
  DocumentDefinition,
  SubmissionFileToken,
} from '@flacso/contracts';

export type MobileFormSectionId =
  | 'personal'
  | 'contacto'
  | 'academico'
  | 'opciones-preinscripcion'
  | 'documentos'
  | 'declaracion';

export type MobileFormSectionCategory =
  | 'personal-data'
  | 'contact'
  | 'academic-history'
  | 'preinscription-options'
  | 'documents'
  | 'declarations';

export interface MobileFormSection {
  id: MobileFormSectionId;
  title: string;
  description?: string;
  category: MobileFormSectionCategory;
  inputKeys: string[];
  documentKeys: string[];
}

const PERSONAL_KEYS = [
  'nombre',
  'nombre1',
  'nombre2',
  'apellido',
  'apellido1',
  'apellido2',
  'fechaNacimiento',
  'tipoDocumento',
  'documento',
  'paisEmisorDocumento',
  'genero',
  'generoOtra',
  'etnia',
  'paisNacimiento',
];

const CONTACT_KEYS = [
  'paisResidencia',
  'ciudadResidencia',
  'domicilio',
  'celular',
  'telefono',
  'email',
  'emailConfirmacion',
  'ocupacion',
];

const ACADEMIC_KEYS = [
  'estudios',
  'posgradoFlacso',
  'posgradoCual',
  'tituloDenominacion',
  'sinTituloActual',
];

const PREINSCRIPTION_OPTION_KEYS = ['orientacion', 'mencion'];

const DECLARATION_KEYS = [
  'tieneConvenio',
  'convenioWordpressId',
  'fuente',
  'aceptaDifusion',
];

export function getMobileFormSections(form: FormDefinition): MobileFormSection[] {
  const allInputs = form.inputs || [];
  const formInputKeys = new Set(allInputs.map((i) => i.key));

  const sections: MobileFormSection[] = [];

  // 1. Personal data
  const personalInputKeys = allInputs
    .filter((i) => (i.stepId === 'personal' && !PREINSCRIPTION_OPTION_KEYS.includes(i.key)) || PERSONAL_KEYS.includes(i.key))
    .map((i) => i.key);
  sections.push({
    id: 'personal',
    title: 'Datos personales y demográficos',
    description: 'Completá tus datos de identificación tal como figuran en tu documento.',
    category: 'personal-data',
    inputKeys: Array.from(new Set(personalInputKeys)),
    documentKeys: [],
  });

  // 2. Contact and residence
  const contactInputKeys = allInputs
    .filter((i) => i.stepId === 'contacto' || CONTACT_KEYS.includes(i.key))
    .map((i) => i.key);
  sections.push({
    id: 'contacto',
    title: 'Residencia y contacto',
    description: 'Indicá tu lugar de residencia actual y tus medios de contacto.',
    category: 'contact',
    inputKeys: Array.from(new Set(contactInputKeys)),
    documentKeys: [],
  });

  // 3. Academic history (strictly personal trajectory, excluding preinscription choices)
  const academicInputKeys = allInputs
    .filter(
      (i) =>
        !PREINSCRIPTION_OPTION_KEYS.includes(i.key) &&
        (i.stepId === 'academico' || ACADEMIC_KEYS.includes(i.key))
    )
    .map((i) => i.key);
  sections.push({
    id: 'academico',
    title: 'Trayectoria académica',
    description: 'Información sobre tu formación previa y antecedentes académicos.',
    category: 'academic-history',
    inputKeys: Array.from(new Set(academicInputKeys)),
    documentKeys: [],
  });

  // 4. Preinscription options (orientation / mention) - only if provided by catalog
  const preinscriptionOptionKeys = PREINSCRIPTION_OPTION_KEYS.filter((k) => formInputKeys.has(k));
  if (preinscriptionOptionKeys.length > 0) {
    sections.push({
      id: 'opciones-preinscripcion',
      title: 'Sobre esta preinscripción',
      description: 'Elegí las opciones específicas para tu postulación a esta propuesta.',
      category: 'preinscription-options',
      inputKeys: preinscriptionOptionKeys,
      documentKeys: [],
    });
  }

  // 5. Documents required
  const documentKeys = (form.documents || []).map((d) => d.key);
  sections.push({
    id: 'documentos',
    title: 'Documentación requerida',
    description: 'Subí los archivos solicitados en formato PDF o imagen.',
    category: 'documents',
    inputKeys: [],
    documentKeys,
  });

  // 6. Declarations and agreements
  const declarationInputKeys = allInputs
    .filter((i) => i.stepId === 'declaracion' || DECLARATION_KEYS.includes(i.key))
    .map((i) => i.key);
  sections.push({
    id: 'declaracion',
    title: 'Convenios y declaraciones',
    description: 'Información sobre convenios institucionales y confirmaciones.',
    category: 'declarations',
    inputKeys: Array.from(new Set(declarationInputKeys)),
    documentKeys: [],
  });

  return sections;
}

export function getDocumentProgress(
  documents: DocumentDefinition[],
  files: SubmissionFileToken[]
): { uploaded: number; required: number; complete: boolean } {
  const requiredDocs = documents.filter((d) => d.required);
  const required = requiredDocs.length;
  if (required === 0) {
    return { uploaded: 0, required: 0, complete: true };
  }

  const uploaded = requiredDocs.filter((doc) =>
    files.some((f) => f.fieldKey === doc.key)
  ).length;

  return {
    uploaded,
    required,
    complete: uploaded >= required,
  };
}

export function getFirstErrorSectionIndex(
  sections: MobileFormSection[],
  errors: Record<string, string>
): number {
  const errorKeys = Object.keys(errors).filter((k) => !!errors[k]);
  if (errorKeys.length === 0) return -1;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const hasError = errorKeys.some(
      (key) => section.inputKeys.includes(key) || section.documentKeys.includes(key)
    );
    if (hasError) return i;
  }

  return -1;
}
