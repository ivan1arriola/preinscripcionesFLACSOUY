import React, { useEffect, useMemo, useState } from 'react';
import { apiClient, ApiError } from '../api/client.js';

interface ProfileVersionEditorProps {
  profile: any;
  activeVersion: any;
  versions: any[];
  csrfToken: string;
  onRefresh: () => void;
}

type EditorTab = 'fields' | 'documents' | 'steps' | 'advanced';
type ProfileDefinition = {
  steps: any[];
  fields: any[];
  documents: any[];
  recommendationLettersCount?: number;
  [key: string]: any;
};

const FIELD_LABELS: Record<string, string> = {
  email: 'Correo electrónico', nombre1: 'Primer nombre', nombre2: 'Segundo nombre',
  apellido1: 'Primer apellido', apellido2: 'Segundo apellido', fechaNacimiento: 'Fecha de nacimiento',
  tipoDocumento: 'Tipo de documento', documento: 'Número de documento', paisEmisorDocumento: 'País emisor del documento',
  genero: 'Identidad de género', etnia: 'Raza / etnia', paisNacimiento: 'País de nacimiento', paisResidencia: 'País de residencia',
  domicilio: 'Domicilio', celular: 'Celular', ocupacion: 'Ocupación', estudios: 'Estudios cursados',
  posgradoFlacso: '¿Cursó un posgrado en FLACSO?', posgradoCual: '¿Cuál posgrado?', orientacion: 'Orientación', mencion: 'Mención',
  titulo: 'Título', escolaridad: 'Escolaridad', institucion: 'Institución', tieneConvenio: '¿Tiene convenio?',
  convenioWordpressId: 'Convenio', fuente: '¿Cómo conoció la propuesta?', aceptaDifusion: 'Autorización de difusión',
};

const CONDITION_LABELS: Record<string, string> = {
  always: 'Siempre', has_orientations: 'Si la oferta tiene orientaciones', has_mentions: 'Si la oferta tiene menciones',
};

const normalizeDefinition = (definition: any): ProfileDefinition => ({
  ...(definition ?? {}),
  steps: Array.isArray(definition?.steps) ? definition.steps : [],
  fields: Array.isArray(definition?.fields) ? definition.fields : [],
  documents: Array.isArray(definition?.documents) ? definition.documents : [],
});

const formatKey = (key: string) => FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());

export const ProfileVersionEditor: React.FC<ProfileVersionEditorProps> = ({ profile, activeVersion, versions, csrfToken, onRefresh }) => {
  const [definition, setDefinition] = useState<ProfileDefinition>(() => normalizeDefinition(activeVersion?.definition));
  const [definitionJson, setDefinitionJson] = useState(() => JSON.stringify(normalizeDefinition(activeVersion?.definition), null, 2));
  const [activeTab, setActiveTab] = useState<EditorTab>('fields');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const nextDefinition = normalizeDefinition(activeVersion?.definition);
    setDefinition(nextDefinition);
    setDefinitionJson(JSON.stringify(nextDefinition, null, 2));
  }, [activeVersion]);

  const stepOptions = useMemo(() => [...definition.steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [definition.steps]);
  const updateDefinition = (updater: (current: ProfileDefinition) => ProfileDefinition) => {
    setDefinition((current) => { const next = updater(current); setDefinitionJson(JSON.stringify(next, null, 2)); return next; });
    setError(null);
  };
  const updateField = (index: number, changes: Record<string, unknown>) => updateDefinition((current) => ({ ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...changes } : field) }));
  const updateDocument = (index: number, changes: Record<string, unknown>) => updateDefinition((current) => ({ ...current, documents: current.documents.map((document, i) => i === index ? { ...document, ...changes } : document) }));
  const updateStep = (index: number, changes: Record<string, unknown>) => updateDefinition((current) => ({ ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...changes } : step) }));

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(definitionJson);
      if (!parsed || typeof parsed !== 'object') throw new Error('object');
      const next = normalizeDefinition(parsed);
      setDefinition(next); setDefinitionJson(JSON.stringify(next, null, 2)); setError(null); setSuccessMessage('Cambios avanzados cargados en el editor.');
    } catch { setError('El contenido debe ser un JSON válido antes de aplicarlo.'); setSuccessMessage(null); }
  };

  const handleCreateVersion = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setSuccessMessage(null); setIsSubmitting(true);
    let parsedDefinition;
    try { parsedDefinition = JSON.parse(definitionJson); } catch { setError('El contenido debe ser un JSON válido.'); setIsSubmitting(false); return; }
    try {
      const newVersion = await apiClient.createProfileVersion(profile.type, parsedDefinition, csrfToken);
      setSuccessMessage(`Versión #${newVersion.versionNumber} creada exitosamente. Podés activarla desde el historial.`); onRefresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Error al crear la versión del perfil.'); }
    finally { setIsSubmitting(false); }
  };

  const handleActivate = async (versionId: string, versionNumber: number) => {
    setError(null); setSuccessMessage(null); setIsSubmitting(true);
    try { await apiClient.activateProfileVersion(profile.type, versionId, csrfToken); setSuccessMessage(`Versión #${versionNumber} activada como la versión vigente.`); onRefresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Error al activar la versión del perfil.'); }
    finally { setIsSubmitting(false); }
  };

  const addField = () => updateDefinition((current) => ({ ...current, fields: [...current.fields, { key: `campoNuevo${current.fields.length + 1}`, stepId: stepOptions[0]?.id ?? '', order: current.fields.length + 1, label: 'Nuevo campo', required: false, condition: 'always' }] }));
  const addDocument = () => updateDefinition((current) => ({ ...current, documents: [...current.documents, { key: `documentoNuevo${current.documents.length + 1}`, stepId: stepOptions[0]?.id ?? '', order: current.documents.length + 1, label: 'Nuevo documento', required: false, canDefer: false, maxFiles: 1 }] }));
  const removeField = (index: number) => updateDefinition((current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }));
  const removeDocument = (index: number) => updateDefinition((current) => ({ ...current, documents: current.documents.filter((_, i) => i !== index) }));

  const tab = (id: EditorTab, label: string) => <button type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className={`px-4 py-3 text-sm font-medium border-b-2 ${activeTab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-gray-900">Perfil: {profile.name}</h2><p className="text-sm text-gray-500 mt-1">Configuración para <strong>{profile.type}</strong> · versión activa <strong className="text-blue-600">#{activeVersion?.versionNumber ?? 'Ninguna'}</strong></p></div><span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Edición guiada</span></div>
      {error && <div className="p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm" role="alert"><strong>Error:</strong> {error}</div>}
      {successMessage && <div className="p-4 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm" role="status">{successMessage}</div>}

      <form onSubmit={handleCreateVersion} className="space-y-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-200"><h3 className="text-lg font-semibold text-gray-900">Editar formulario</h3><p className="text-sm text-gray-600 mt-1">Configurá qué pregunta el formulario, en qué orden y qué documentación solicita. Los cambios se guardan como una nueva versión.</p></div>
          <div className="flex flex-wrap border-b border-gray-200 px-2" role="tablist" aria-label="Secciones de configuración">{tab('fields', 'Campos del formulario')}{tab('documents', 'Documentación')}{tab('steps', 'Pasos y orden')}{tab('advanced', 'Avanzado')}</div>
          <div className="p-5">
            {activeTab === 'fields' && <section aria-labelledby="fields-heading" className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 id="fields-heading" className="text-lg font-semibold text-gray-900">Campos del formulario</h4><p className="text-sm text-gray-500">Definí las preguntas universales y las que dependen de orientaciones o menciones.</p></div><button type="button" onClick={addField} className="px-3 py-2 border border-blue-200 text-blue-700 bg-blue-50 rounded text-sm font-medium">+ Agregar campo</button></div>{definition.fields.length === 0 ? <p className="p-4 rounded border border-dashed border-gray-300 text-sm text-gray-500">No hay campos configurados.</p> : definition.fields.map((field, index) => <div key={`${field.key}-${index}`} className="p-4 rounded-md border border-gray-200 bg-gray-50 space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs font-mono text-gray-500">{field.key}</span><p className="text-sm font-semibold text-gray-900">{formatKey(field.key)}</p></div><button type="button" onClick={() => removeField(index)} className="text-xs text-red-700">Quitar</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-sm font-medium text-gray-700">Etiqueta visible<input aria-label={`Etiqueta del campo ${field.key}`} value={field.label ?? ''} onChange={(e) => updateField(index, { label: e.target.value })} disabled={isSubmitting} /></label><label className="text-sm font-medium text-gray-700">Paso<select aria-label={`Paso del campo ${field.key}`} value={field.stepId} onChange={(e) => updateField(index, { stepId: e.target.value })} disabled={isSubmitting}>{stepOptions.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label><label className="text-sm font-medium text-gray-700">Condición<select aria-label={`Condición del campo ${field.key}`} value={field.condition ?? 'always'} onChange={(e) => updateField(index, { condition: e.target.value })} disabled={isSubmitting}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="flex items-center gap-2 text-sm font-medium text-gray-700 pt-6"><input aria-label={`Obligatorio ${field.key}`} type="checkbox" checked={Boolean(field.required)} onChange={(e) => updateField(index, { required: e.target.checked })} disabled={isSubmitting} /> Campo obligatorio</label></div></div>)}</section>}
            {activeTab === 'documents' && <section aria-labelledby="documents-heading" className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 id="documents-heading" className="text-lg font-semibold text-gray-900">Documentación requerida</h4><p className="text-sm text-gray-500">Configurá archivos obligatorios, diferibles y cantidad máxima.</p></div><button type="button" onClick={addDocument} className="px-3 py-2 border border-blue-200 text-blue-700 bg-blue-50 rounded text-sm font-medium">+ Agregar documento</button></div>{definition.documents.length === 0 ? <p className="p-4 rounded border border-dashed border-gray-300 text-sm text-gray-500">Este tipo de oferta no solicita documentación.</p> : definition.documents.map((document, index) => <div key={`${document.key}-${index}`} className="p-4 rounded-md border border-gray-200 bg-gray-50 space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs font-mono text-gray-500">{document.key}</span><p className="text-sm font-semibold text-gray-900">{document.label ?? formatKey(document.key)}</p></div><button type="button" onClick={() => removeDocument(index)} className="text-xs text-red-700">Quitar</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label className="text-sm font-medium text-gray-700">Nombre del documento<input aria-label={`Etiqueta del documento ${document.key}`} value={document.label ?? ''} onChange={(e) => updateDocument(index, { label: e.target.value })} disabled={isSubmitting} /></label><label className="text-sm font-medium text-gray-700">Paso<select aria-label={`Paso del documento ${document.key}`} value={document.stepId} onChange={(e) => updateDocument(index, { stepId: e.target.value })} disabled={isSubmitting}>{stepOptions.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label><label className="text-sm font-medium text-gray-700">Cantidad máxima<input aria-label={`Cantidad máxima ${document.key}`} type="number" min="1" value={document.maxFiles ?? 1} onChange={(e) => updateDocument(index, { maxFiles: Number(e.target.value) })} disabled={isSubmitting} /></label><div className="flex flex-wrap items-center gap-4 pt-6"><label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input aria-label={`Obligatorio ${document.key}`} type="checkbox" checked={Boolean(document.required)} onChange={(e) => updateDocument(index, { required: e.target.checked })} disabled={isSubmitting} /> Obligatorio</label><label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input aria-label={`Diferible ${document.key}`} type="checkbox" checked={Boolean(document.canDefer)} onChange={(e) => updateDocument(index, { canDefer: e.target.checked })} disabled={isSubmitting} /> Se puede enviar después</label></div></div></div>)}{profile.type === 'maestria' && <label className="block max-w-xs text-sm font-medium text-gray-700">Cartas de recomendación<input aria-label="Cantidad de cartas de recomendación" type="number" min="0" value={definition.recommendationLettersCount ?? 2} onChange={(e) => updateDefinition((current) => ({ ...current, recommendationLettersCount: Number(e.target.value) }))} disabled={isSubmitting} /></label>}</section>}
            {activeTab === 'steps' && <section aria-labelledby="steps-heading" className="space-y-4"><div><h4 id="steps-heading" className="text-lg font-semibold text-gray-900">Pasos y orden</h4><p className="text-sm text-gray-500">El orden define cómo se presenta el formulario de preinscripción.</p></div>{definition.steps.map((step, index) => <div key={`${step.id}-${index}`} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end p-4 rounded-md border border-gray-200 bg-gray-50"><label className="text-sm font-medium text-gray-700">Orden<input aria-label={`Orden del paso ${step.id}`} type="number" min="1" value={step.order} onChange={(e) => updateStep(index, { order: Number(e.target.value) })} disabled={isSubmitting} /></label><label className="text-sm font-medium text-gray-700">Título<input aria-label={`Título del paso ${step.id}`} value={step.title} onChange={(e) => updateStep(index, { title: e.target.value })} disabled={isSubmitting} /></label><label className="text-sm font-medium text-gray-700">Descripción<input aria-label={`Descripción del paso ${step.id}`} value={step.description ?? ''} onChange={(e) => updateStep(index, { description: e.target.value })} disabled={isSubmitting} /></label></div>)}</section>}
            {activeTab === 'advanced' && <section aria-labelledby="advanced-heading" className="space-y-4"><div><h4 id="advanced-heading" className="text-lg font-semibold text-gray-900">Configuración avanzada</h4><p className="text-sm text-gray-500">Usá este editor solo si necesitás modificar una propiedad que no aparece en la interfaz guiada.</p></div><label htmlFor="definition-editor" className="sr-only">Definición JSON del perfil</label><textarea id="definition-editor" aria-label="Definición JSON del perfil" value={definitionJson} onChange={(e) => setDefinitionJson(e.target.value)} rows={18} className="w-full font-mono text-xs p-3 rounded border border-gray-300" disabled={isSubmitting} /><button type="button" onClick={handleApplyJson} className="px-3 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700">Aplicar JSON al editor</button></section>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-t border-gray-200 bg-gray-50"><p className="text-xs text-gray-500">Crear una versión no la activa automáticamente.</p><button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Guardando…' : 'Crear nueva versión'}</button></div>
        </div>
      </form>

      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-4"><div><h3 className="text-lg font-semibold text-gray-900">Historial de versiones</h3><p className="text-sm text-gray-500">Las versiones son inmutables. Activá una versión anterior si necesitás volver atrás.</p></div><div className="space-y-3">{versions.map((version) => { const isActive = version.id === profile.activeVersionId; return <div key={version.id} className="p-4 rounded-md border border-gray-200 flex flex-wrap items-center justify-between gap-3"><div><span className="font-semibold text-gray-900">Versión #{version.versionNumber}</span>{isActive && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Activa</span>}<p className="text-xs text-gray-500 mt-1">Creada por: {version.createdBy}</p></div><div className="flex items-center gap-3"><button type="button" onClick={() => { const next = normalizeDefinition(version.definition); setDefinition(next); setDefinitionJson(JSON.stringify(next, null, 2)); setActiveTab('fields'); }} className="text-xs text-blue-700">Cargar para revisar</button>{!isActive && <button type="button" disabled={isSubmitting} onClick={() => handleActivate(version.id, version.versionNumber)} className="px-3 py-1.5 bg-gray-100 hover:bg-green-600 hover:text-white rounded text-xs font-medium border border-gray-300">Activar versión</button>}</div></div>; })}</div></div>
    </div>
  );
};
