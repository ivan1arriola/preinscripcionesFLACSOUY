import type { DocumentDefinition, FormDefinition, SubmissionFileToken } from '@flacso/contracts';

export type MobileFormSectionCategory =
  | 'personal-data'
  | 'contact'
  | 'academic-history'
  | 'preinscription-options'
  | 'documents'
  | 'declarations';

export interface MobileFormSection {
  id: string;
  title: string;
  description: string;
  category: MobileFormSectionCategory;
  inputKeys: string[];
  documentKeys: string[];
}

const fallbackGroups: Array<{
  id: string;
  title: string;
  description: string;
  category: MobileFormSectionCategory;
  stepIds: string[];
  keys: string[];
}> = [
  {
    id: 'personal',
    title: 'Datos personales',
    description: 'Completá tus datos de identificación tal como figuran en tu documento.',
    category: 'personal-data',
    stepIds: ['personal'],
    keys: ['nombre', 'nombre1', 'nombre2', 'apellido', 'apellido1', 'apellido2', 'fechaNacimiento', 'tipoDocumento', 'documento', 'paisEmisorDocumento', 'genero', 'generoOtra', 'etnia', 'paisNacimiento'],
  },
  {
    id: 'contacto',
    title: 'Residencia y contacto',
    description: 'Indicá tu lugar de residencia actual y tus medios de contacto.',
    category: 'contact',
    stepIds: ['contacto'],
    keys: ['paisResidencia', 'ciudadResidencia', 'domicilio', 'celular', 'telefono', 'email', 'emailConfirmacion', 'ocupacion'],
  },
  {
    id: 'academico',
    title: 'Trayectoria académica',
    description: 'Contanos sobre tus estudios y antecedentes académicos.',
    category: 'academic-history',
    stepIds: ['academico'],
    keys: ['estudios', 'posgradoFlacso', 'posgradoCual', 'tituloDenominacion', 'sinTituloActual'],
  },
  {
    id: 'opciones-preinscripcion',
    title: 'Sobre esta preinscripción',
    description: 'Elegí la orientación o mención correspondiente a esta propuesta.',
    category: 'preinscription-options',
    stepIds: ['orientacion'],
    keys: ['orientacion', 'mencion'],
  },
  {
    id: 'declaracion',
    title: 'Convenios y declaraciones',
    description: 'Completá las declaraciones finales de tu solicitud.',
    category: 'declarations',
    stepIds: ['declaracion'],
    keys: ['tieneConvenio', 'convenioWordpressId', 'fuente', 'aceptaDifusion', 'aceptaComunicaciones'],
  },
];

export function getMobileFormSections(form: FormDefinition): MobileFormSection[] {
  const inputs = form.inputs ?? [];
  const sections: MobileFormSection[] = [];

  for (const group of fallbackGroups) {
    const inputKeys = inputs
      .filter((input) => group.stepIds.includes(input.stepId ?? '') || group.keys.includes(input.key))
      .map((input) => input.key)
      .filter((key, index, all) => all.indexOf(key) === index);

    if (
      group.category === 'preinscription-options' &&
      (form.orientations?.length ?? 0) === 0 &&
      (form.mentions?.length ?? 0) === 0
    ) continue;

    sections.push({
      id: group.id,
      title: group.title,
      description: group.description,
      category: group.category,
      inputKeys,
      documentKeys: [],
    });
  }

  const documents = form.documents ?? [];
  const documentSection: MobileFormSection = {
    id: 'documentos',
    title: 'Documentación requerida',
    description: 'Adjuntá los documentos necesarios para completar tu preinscripción.',
    category: 'documents',
    inputKeys: [],
    documentKeys: documents.map((document) => document.key),
  };
  const declarationIndex = sections.findIndex((section) => section.category === 'declarations');
  sections.splice(declarationIndex < 0 ? sections.length : declarationIndex, 0, documentSection);
  return sections;
}

export function getDocumentProgress(
  documents: DocumentDefinition[],
  files: SubmissionFileToken[],
): { uploaded: number; required: number; complete: boolean } {
  const requiredDocuments = documents.filter((document) => document.required && !document.canDefer);
  const uploaded = requiredDocuments.filter((document) => files.some((file) => file.fieldKey === document.key)).length;
  return { uploaded, required: requiredDocuments.length, complete: uploaded === requiredDocuments.length };
}

export function getFirstErrorSectionIndex(
  sections: MobileFormSection[],
  errors: Record<string, string | undefined>,
): number {
  return sections.findIndex((section) => section.inputKeys.concat(section.documentKeys).some((key) => Boolean(errors[key])));
}
