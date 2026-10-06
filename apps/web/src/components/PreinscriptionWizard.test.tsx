import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreinscriptionWizard } from './PreinscriptionWizard.js';
import { getCanonicalFormDefinition } from '@flacso/contracts';
import type { AcademicTarget, AgreementOption, FormDefinition } from '@flacso/contracts';

const createForm = (
  target: Partial<AcademicTarget> & { id: string; kind: 'academic_offer' | 'seminar'; title: string },
  agreements: AgreementOption[] = []
): FormDefinition => {
  const fullTarget: AcademicTarget = {
    offerType: 'diploma',
    registrationOpen: true,
    configRevision: 'rev-1',
    orientations: [],
    mentions: [],
    ...target,
  };
  const result = getCanonicalFormDefinition(fullTarget, agreements);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('PreinscriptionWizard Component', () => {
  const startWizard = () => {
    fireEvent.click(screen.getByRole('button', { name: /Comenzar preinscripción/i }));
  };

  const diplomaForm = createForm(
    {
      id: 'davia-c11',
      title: 'DAVIA Cohorte 11',
      kind: 'academic_offer',
      offerType: 'diploma',
      registrationOpen: true,
      configRevision: 'davia-rev',
      orientations: ['Educación', 'Políticas Públicas'],
      mentions: ['Tecnología Educativa'],
    },
    [{ id: 'conv-1', label: 'Convenio Colegio' }]
  );

  const seminarForm = createForm({
    id: 'sem-ia',
    title: 'Seminario IA',
    kind: 'seminar',
    offerType: 'seminar',
    registrationOpen: true,
    configRevision: 'sem-rev',
    orientations: [],
    mentions: [],
  });

  const maestriaForm = createForm({
    id: 'mae-soc',
    title: 'Maestría en Ciencias Sociales',
    kind: 'academic_offer',
    offerType: 'maestria',
    registrationOpen: true,
    configRevision: 'mae-rev',
    orientations: [],
    mentions: [],
  });

  it('renders progress bar with the separate orientation step and starts at step 1', () => {
    render(<PreinscriptionWizard form={diplomaForm} onSubmit={vi.fn()} />);
    startWizard();

    expect(screen.getAllByText('Datos personales y demográficos')).toHaveLength(3);
    expect(screen.getByText('Residencia y contacto')).toBeInTheDocument();
    expect(screen.getByText('Trayectoria académica')).toBeInTheDocument();
    expect(screen.getByText('Orientación y mención')).toBeInTheDocument();
    expect(screen.getByText('Documentación requerida')).toBeInTheDocument();
    expect(screen.getByText('Convenios y declaraciones')).toBeInTheDocument();

    expect(screen.getByLabelText(/Primer nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primer apellido/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Título/)).not.toBeInTheDocument();
  });

  it('blocks advance when current step required fields are missing', async () => {
    render(<PreinscriptionWizard form={diplomaForm} onSubmit={vi.fn()} />);
    startWizard();

    // Click "Siguiente →" without filling fields
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    expect(screen.getAllByText(/El campo Primer nombre es obligatorio/i).length).toBeGreaterThan(0);
    // Stays on step 1
    expect(screen.getByLabelText(/Primer nombre/i)).toBeInTheDocument();
  });

  it('advances through all 5 steps and submits on final declaration step', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const mockUpload = vi.fn().mockImplementation((fieldKey: string) =>
      Promise.resolve({
        token: `token-${fieldKey}`,
        fieldKey,
        originalName: `${fieldKey}.pdf`,
        size: 1024,
        mimeType: 'application/pdf',
      })
    );

    render(
      <PreinscriptionWizard
        form={diplomaForm}
        onSubmit={handleSubmit}
        onUpload={mockUpload}
      />
    );
    startWizard();

    // Step 1: Personal
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Lucía' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Méndez' } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/i), { target: { value: '1990-05-15' } });
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'cedula_uruguaya' } });
    fireEvent.change(screen.getByLabelText(/Cédula de identidad uruguaya/i), { target: { value: '34567894' } });
    fireEvent.change(screen.getByLabelText(/Identidad de género/i), { target: { value: 'Mujer' } });
    fireEvent.change(screen.getByLabelText(/Raza \/ etnia/i), { target: { value: 'Blanca' } });
    fireEvent.change(screen.getByLabelText(/País de nacimiento/i), { target: { value: 'Uruguay' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: Contacto
    expect(screen.getByLabelText(/País de residencia/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/País de residencia/i), { target: { value: 'Uruguay' } });
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Montevideo' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '099 123 456' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'lucia@example.com' } });
    fireEvent.change(screen.getByLabelText(/Ocupación actual/i), { target: { value: 'Docente' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3: Académico
    expect(screen.getByLabelText(/Estudios cursados/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Estudios cursados/i), { target: { value: 'Universitario' } });
    fireEvent.click(screen.getByRole('radio', { name: 'No' })); // posgradoFlacso
    fireEvent.change(screen.getByLabelText(/Denominación del título/i), { target: { value: 'Licenciada' } });
    const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Archivo del título/i), { target: { files: [dummyFile] } });
    await waitFor(() => expect(screen.getByText('titulo.pdf')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 4: Orientación y mención
    fireEvent.change(screen.getByLabelText(/Orientación/i), { target: { value: 'Educación' } });
    fireEvent.change(screen.getByLabelText(/Mención/i), { target: { value: 'Tecnología Educativa' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 5: Documentos
    expect(screen.getByLabelText(/Documento de identidad/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Curriculum Vitae/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Carta de motivación/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Documento de identidad/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Curriculum Vitae/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Carta de motivación/i), { target: { files: [dummyFile] } });

    await waitFor(() => {
      expect(screen.getByText('identidad.pdf')).toBeInTheDocument();
      expect(screen.getByText('cv.pdf')).toBeInTheDocument();
      expect(screen.getByText('cartaMotivacion.pdf')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 6: Convenios y declaraciones
    expect(screen.getByRole('heading', { name: 'Convenios y declaraciones' })).toBeInTheDocument();
    const noRadios = screen.getAllByRole('radio', { name: 'No' });
    // tieneConvenio = No
    fireEvent.click(noRadios[0]!);
    // fuente
    fireEvent.change(screen.getByLabelText(/¿Cómo conociste esta propuesta\?/i), { target: { value: 'Web' } });
    // aceptaDifusion = Sí
    const yesRadios = screen.getAllByRole('radio', { name: 'Sí' });
    fireEvent.click(yesRadios[1]!);

    // Verify navigating back to step 1 and then back to step 5 via progress buttons
    const step1Btn = screen.getByRole('button', { name: /Datos personales y demográficos/i });
    fireEvent.click(step1Btn);
    expect(screen.getByLabelText(/Primer nombre/i)).toHaveValue('Lucía');

    const step5Btn = screen.getByRole('button', { name: /Convenios y declaraciones/i });
    fireEvent.click(step5Btn);

    // Final submit button on step 5
    const reviewBtn = screen.getByRole('button', { name: /Revisar datos/i });
    fireEvent.click(reviewBtn);

    expect(screen.getByRole('heading', { name: /Revisión de datos antes de enviar/i })).toBeInTheDocument();
    expect(screen.getByText('Montevideo')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar y enviar preinscripción/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
      const [submittedValues, submittedFiles] = handleSubmit.mock.calls[0] as [Record<string, unknown>, unknown[]];
      expect(submittedValues.nombre1).toBe('Lucía');
      expect(submittedValues.orientacion).toBe('Educación');
      expect(submittedValues.ciudadResidencia).toBe('Montevideo');
      expect(submittedValues.tituloDenominacion).toBe('Licenciada');
      expect(submittedFiles).toHaveLength(4);
    });
  }, 15000);

  it('omits orientation and mention selectors when target has none (seminar)', () => {
    render(<PreinscriptionWizard form={seminarForm} onSubmit={vi.fn()} />);
    startWizard();

    // Check steps: exactly 5 canonical steps
    expect(screen.getAllByText('Datos personales y demográficos')).toHaveLength(3);
    expect(screen.getByText('Residencia y contacto')).toBeInTheDocument();
    expect(screen.getByText('Trayectoria académica')).toBeInTheDocument();
    expect(screen.getByText('Documentación requerida')).toBeInTheDocument();
    expect(screen.getByText('Convenios y declaraciones')).toBeInTheDocument();

    // Fill step 1
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Carlos' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Silva' } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/i), { target: { value: '1985-02-10' } });
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'cedula_uruguaya' } });
    fireEvent.change(screen.getByLabelText(/Cédula de identidad uruguaya/i), { target: { value: '34567894' } });
    fireEvent.change(screen.getByLabelText(/Identidad de género/i), { target: { value: 'Varon' } });
    fireEvent.change(screen.getByLabelText(/Raza \/ etnia/i), { target: { value: 'Blanca' } });
    fireEvent.change(screen.getByLabelText(/País de nacimiento/i), { target: { value: 'Uruguay' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Fill step 2
    fireEvent.change(screen.getByLabelText(/País de residencia/i), { target: { value: 'Uruguay' } });
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Maldonado' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '099 123 456' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'carlos@example.com' } });
    fireEvent.change(screen.getByLabelText(/Ocupación actual/i), { target: { value: 'Investigador' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3 (Trayectoria académica): verify no orientation or mention fields
    expect(screen.getByRole('heading', { name: 'Trayectoria académica' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Orientación/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Mención/i)).not.toBeInTheDocument();
  });

  it('requires two recommendation letters on maestria step 4', async () => {
    const mockUpload = vi.fn().mockImplementation((fieldKey: string) =>
      Promise.resolve({
        token: `token-${fieldKey}`,
        fieldKey,
        originalName: `${fieldKey}.pdf`,
        size: 1024,
        mimeType: 'application/pdf',
      })
    );

    render(
      <PreinscriptionWizard
        form={maestriaForm}
        onSubmit={vi.fn()}
        onUpload={mockUpload}
      />
    );
    startWizard();

    // Step 1: Personal
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'García' } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/i), { target: { value: '1992-03-20' } });
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'cedula_uruguaya' } });
    fireEvent.change(screen.getByLabelText(/Cédula de identidad uruguaya/i), { target: { value: '34567894' } });
    fireEvent.change(screen.getByLabelText(/Identidad de género/i), { target: { value: 'Mujer' } });
    fireEvent.change(screen.getByLabelText(/Raza \/ etnia/i), { target: { value: 'Blanca' } });
    fireEvent.change(screen.getByLabelText(/País de nacimiento/i), { target: { value: 'Uruguay' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: Contacto
    fireEvent.change(screen.getByLabelText(/País de residencia/i), { target: { value: 'Uruguay' } });
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Salto' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '099 123 456' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText(/Ocupación actual/i), { target: { value: 'Investigadora' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3: Académico
    fireEvent.change(screen.getByLabelText(/Estudios cursados/i), { target: { value: 'Universitario' } });
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    fireEvent.change(screen.getByLabelText(/Denominación del título/i), { target: { value: 'Licenciada en Sociología' } });
    const academicTitleFile = new File(['dummy content'], 'title.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Archivo del título/i), { target: { files: [academicTitleFile] } });
    await waitFor(() => expect(screen.getByText('titulo.pdf')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 4: Documentos - must include the two recommendation letters
    expect(screen.getByLabelText(/Primera carta de recomendación/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Segunda carta de recomendación/i)).toBeInTheDocument();

    // Trying to advance without uploading recommendation letters should fail
    const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Documento de identidad/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Curriculum Vitae/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Carta de motivación/i), { target: { files: [dummyFile] } });

    await waitFor(() => {
      expect(screen.getByText('cartaMotivacion.pdf')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Errors for the two recommendation letters
    expect(screen.getAllByText(/El documento Primera carta de recomendación es obligatorio/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/El documento Segunda carta de recomendación es obligatorio/i).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/Primera carta de recomendación/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Segunda carta de recomendación/i), { target: { files: [dummyFile] } });
    await waitFor(() => {
      expect(screen.getAllByText('cartaRecomendacion1.pdf').length).toBeGreaterThan(0);
      expect(screen.getAllByText('cartaRecomendacion2.pdf').length).toBeGreaterThan(0);
    });

    // Should now allow advancing to Step 5
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(screen.getByRole('heading', { name: 'Convenios y declaraciones' })).toBeInTheDocument();
  });

  it('allows checking "No poseo actualmente título" to skip degree denomination and file', async () => {
    const mockUpload = vi.fn().mockImplementation((fieldKey: string) =>
      Promise.resolve({
        token: `token-${fieldKey}`,
        fieldKey,
        originalName: `${fieldKey}.pdf`,
        size: 1024,
        mimeType: 'application/pdf',
      })
    );

    render(<PreinscriptionWizard form={diplomaForm} onSubmit={vi.fn()} onUpload={mockUpload} />);
    startWizard();

    // Step 1: Personal
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Elena' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Pérez' } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/i), { target: { value: '1991-04-12' } });
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'cedula_uruguaya' } });
    fireEvent.change(screen.getByLabelText(/Cédula de identidad uruguaya/i), { target: { value: '34567894' } });
    fireEvent.change(screen.getByLabelText(/Identidad de género/i), { target: { value: 'Mujer' } });
    fireEvent.change(screen.getByLabelText(/Raza \/ etnia/i), { target: { value: 'Blanca' } });
    fireEvent.change(screen.getByLabelText(/País de nacimiento/i), { target: { value: 'Uruguay' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: Contacto
    fireEvent.change(screen.getByLabelText(/País de residencia/i), { target: { value: 'Uruguay' } });
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Montevideo' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '099 123 456' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'elena@example.com' } });
    fireEvent.change(screen.getByLabelText(/Ocupación actual/i), { target: { value: 'Gestora' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3: Académico
    fireEvent.change(screen.getByLabelText(/Estudios cursados/i), { target: { value: 'Terciario' } });
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    const noTituloCheckbox = screen.getByLabelText(/No poseo actualmente título/i);
    fireEvent.click(noTituloCheckbox);
    expect(screen.queryByLabelText(/Denominación del título/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Archivo del título/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 4: Orientación y mención
    fireEvent.change(screen.getByLabelText(/Orientación/i), { target: { value: 'Educación' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 5: Documentos
    const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Documento de identidad/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Curriculum Vitae/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Carta de motivación/i), { target: { files: [dummyFile] } });

    await waitFor(() => {
      expect(screen.getByText('cartaMotivacion.pdf')).toBeInTheDocument();
    });

    // Advancing should succeed without degree fields
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(screen.getByRole('heading', { name: 'Convenios y declaraciones' })).toBeInTheDocument();
  });

  it('validates conditional rules in the browser (convenio, posgrado, genero, paisEmisor)', async () => {
    const mockUpload = vi.fn().mockImplementation((fieldKey: string) =>
      Promise.resolve({
        token: `token-${fieldKey}`,
        fieldKey,
        originalName: `${fieldKey}.pdf`,
        size: 1024,
        mimeType: 'application/pdf',
      })
    );

    render(<PreinscriptionWizard form={diplomaForm} onSubmit={vi.fn()} onUpload={mockUpload} />);
    startWizard();

    // Step 1: select genero = Otra and tipoDocumento = pasaporte
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Taylor' } });
    fireEvent.change(screen.getByLabelText(/Fecha de nacimiento/i), { target: { value: '1995-07-20' } });
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'pasaporte' } });
    fireEvent.change(screen.getByLabelText(/Número de documento/i), { target: { value: 'PAS123' } });
    fireEvent.change(screen.getByLabelText(/Identidad de género/i), { target: { value: 'Otra' } });
    fireEvent.change(screen.getByLabelText(/Raza \/ etnia/i), { target: { value: 'Blanca' } });
    fireEvent.change(screen.getByLabelText(/País de nacimiento/i), { target: { value: 'Argentina' } });

    // Click siguiente without specifying generoOtra and paisEmisorDocumento
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    expect(screen.getAllByText(/Debe especificar su identidad de género/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Debe especificar el país emisor del documento/i).length).toBeGreaterThan(0);

    // Fill them and advance
    fireEvent.change(screen.getByLabelText(/Especifique su identidad de género/i), { target: { value: 'No binarie' } });
    fireEvent.change(screen.getByLabelText(/País emisor del documento/i), { target: { value: 'Argentina' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: Contacto
    fireEvent.change(screen.getByLabelText(/País de residencia/i), { target: { value: 'Argentina' } });
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Buenos Aires' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '1112345678' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText(/Ocupación actual/i), { target: { value: 'Investigadore' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3: Académico - select posgradoFlacso = Si
    fireEvent.change(screen.getByLabelText(/Estudios cursados/i), { target: { value: 'Universitario' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Sí' })); // posgradoFlacso

    // Click siguiente without specifying posgradoCual
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(screen.getAllByText(/Debe especificar qué posgrado cursó en FLACSO/i).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/¿Cuál posgrado\?/i), { target: { value: 'Diploma en Género' } });
    fireEvent.change(screen.getByLabelText(/Denominación del título/i), { target: { value: 'Licenciatura' } });
    const academicFile = new File(['dummy content'], 'title.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Archivo del título/i), { target: { files: [academicFile] } });
    await waitFor(() => expect(screen.getByText('titulo.pdf')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 4: Orientación y mención
    fireEvent.change(screen.getByLabelText(/Orientación/i), { target: { value: 'Educación' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 5: Documentos
    const dummyFile = new File(['dummy content'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Documento de identidad/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Curriculum Vitae/i), { target: { files: [dummyFile] } });
    fireEvent.change(screen.getByLabelText(/Carta de motivación/i), { target: { files: [dummyFile] } });

    await waitFor(() => {
      expect(screen.getByText('cartaMotivacion.pdf')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 5: Declaraciones - select tieneConvenio = Si
    expect(screen.getByRole('heading', { name: 'Convenios y declaraciones' })).toBeInTheDocument();
    const yesRadios = screen.getAllByRole('radio', { name: 'Sí' });
    fireEvent.click(yesRadios[0]!); // tieneConvenio = Si
    fireEvent.change(screen.getByLabelText(/¿Cómo conociste esta propuesta\?/i), { target: { value: 'Web' } });
    fireEvent.click(yesRadios[1]!); // aceptaDifusion = Si

    // Click submit without selecting agreement
    fireEvent.click(screen.getByRole('button', { name: /Revisar datos/i }));
    expect(screen.getAllByText(/Debe seleccionar el convenio correspondiente/i).length).toBeGreaterThan(0);
  });

  it('renders final submit button with institutional blue palette, wizard-submit-action class and no green classes', () => {
    const singleStepForm: FormDefinition = {
      ...diplomaForm,
      steps: [{ id: 'declaracion', title: 'Declaración', description: '', order: 1 }],
      inputs: [],
      documents: [],
    };
    const { rerender } = render(<PreinscriptionWizard form={singleStepForm} onSubmit={vi.fn()} isSubmitting={false} />);
    startWizard();
    const submitBtn = screen.getByRole('button', { name: /Revisar datos/i });
    expect(submitBtn).toBeInTheDocument();
    expect(submitBtn).toHaveClass('wizard-submit-action');
    expect(submitBtn.className).not.toMatch(/green/i);
    expect(submitBtn).not.toBeDisabled();

    rerender(<PreinscriptionWizard form={singleStepForm} onSubmit={vi.fn()} isSubmitting={true} />);
    const disabledBtn = screen.getByRole('button', { name: /Revisar datos/i });
    expect(disabledBtn).toBeDisabled();
  });

  it('navigates to data review screen, shows summary with sections and handles loading overlay during submission', async () => {
    let resolveSubmit!: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const handleSubmit = vi.fn().mockImplementation(() => submitPromise);

    const testForm: FormDefinition = {
      ...diplomaForm,
      steps: [
        { id: 'contacto', title: 'Residencia y contacto', order: 1 },
        { id: 'declaracion', title: 'Convenios y declaraciones', order: 2 },
      ],
      inputs: [
        { key: 'ciudadResidencia', label: 'Ciudad de residencia', type: 'text', required: true, stepId: 'contacto' },
        { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, stepId: 'declaracion' },
        { key: 'fuente', label: '¿Cómo conociste esta propuesta?', type: 'select', required: true, stepId: 'declaracion' },
        { key: 'aceptaDifusion', label: '¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?', type: 'select', required: true, stepId: 'declaracion' },
      ],
      documents: [],
    };

    const { rerender } = render(<PreinscriptionWizard form={testForm} onSubmit={handleSubmit} isSubmitting={false} />);
    startWizard();

    // Step 1: contacto
    fireEvent.change(screen.getByLabelText(/Ciudad de residencia/i), { target: { value: 'Montevideo' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: declaracion
    const noRadios = screen.getAllByRole('radio', { name: 'No' });
    fireEvent.click(noRadios[0]!); // tieneConvenio = No
    fireEvent.change(screen.getByLabelText(/¿Cómo conociste esta propuesta\?/i), { target: { value: 'Web' } });
    const yesRadios = screen.getAllByRole('radio', { name: 'Sí' });
    fireEvent.click(yesRadios[1]!); // aceptaDifusion = Sí

    // Click Revisar datos
    fireEvent.click(screen.getByRole('button', { name: /Revisar datos/i }));

    // Check review screen
    expect(screen.getByRole('heading', { name: /Revisión de datos antes de enviar/i })).toBeInTheDocument();
    expect(screen.getByText('Montevideo')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /Confirmar y enviar preinscripción/i });
    expect(confirmBtn).toBeInTheDocument();

    // Click confirm with pending submission
    fireEvent.click(confirmBtn);
    expect(handleSubmit).toHaveBeenCalledTimes(1);

    // While submitting, rerender with isSubmitting = true
    rerender(<PreinscriptionWizard form={testForm} onSubmit={handleSubmit} isSubmitting={true} />);

    const loadingScreen = screen.getByRole('status');
    expect(loadingScreen).toBeInTheDocument();
    expect(loadingScreen).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('heading', { name: /Revisión de datos antes de enviar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar y enviar preinscripción/i })).not.toBeInTheDocument();
    expect(screen.getByText('Enviando tu preinscripción…')).toBeInTheDocument();
    expect(screen.getByText(/Guardando tus datos y documentación en FLACSO Uruguay/i)).toBeInTheDocument();

    // Finish submission
    resolveSubmit();
  });
});
