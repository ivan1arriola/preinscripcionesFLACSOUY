import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreinscriptionWizard } from './PreinscriptionWizard.js';
import type { FormDefinition } from '@flacso/contracts';

describe('PreinscriptionWizard Component', () => {
  const academicOfferForm: FormDefinition = {
    targetId: 'davia-c11',
    title: 'DAVIA Cohorte 11',
    kind: 'academic_offer',
    offerType: 'diploma',
    registrationOpen: true,
    configRevision: 'davia-rev',
    effectiveRevision: 'sha256:davia-effective-rev',
    profileVersionId: 'ver_diploma_v1',
    steps: [
      { id: 'personal', title: 'Datos personales', order: 1 },
      { id: 'contacto', title: 'Contacto', order: 2 },
      { id: 'academico', title: 'Formación académica', order: 3 },
      { id: 'documentos', title: 'Documentación', order: 4 },
      { id: 'confirmacion', title: 'Confirmación y envío', order: 5 },
    ],
    inputs: [
      { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, position: 1, stepId: 'personal' },
      { key: 'apellido1', label: 'Primer apellido', type: 'text', required: true, position: 2, stepId: 'personal' },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 3, stepId: 'contacto' },
      { key: 'celular', label: 'Celular', type: 'tel', required: true, position: 4, stepId: 'contacto' },
      { key: 'titulo', label: 'Título obtenido', type: 'text', required: true, position: 5, stepId: 'academico' },
      { key: 'orientacion', label: 'Orientación', type: 'select', required: true, position: 6, stepId: 'academico' },
      { key: 'mencion', label: 'Mención', type: 'select', required: false, position: 7, stepId: 'academico' },
    ],
    documents: [
      {
        key: 'cv',
        stepId: 'documentos',
        label: 'Curriculum Vitae',
        required: true,
        canDefer: false,
        maxFiles: 1,
        maxBytes: 10 * 1024 * 1024,
      },
    ],
    orientations: ['Educación', 'Políticas Públicas'],
    mentions: ['Tecnología Educativa'],
  };

  const seminarForm: FormDefinition = {
    targetId: 'sem-ia',
    title: 'Seminario IA',
    kind: 'seminar',
    offerType: 'seminar',
    registrationOpen: true,
    configRevision: 'sem-rev',
    effectiveRevision: 'sha256:sem-effective-rev',
    profileVersionId: 'ver_seminar_v1',
    steps: [
      { id: 'personal', title: 'Datos personales', order: 1 },
      { id: 'contacto', title: 'Contacto', order: 2 },
      { id: 'academico', title: 'Formación previa', order: 3 },
      { id: 'confirmacion', title: 'Confirmación y envío', order: 4 },
    ],
    inputs: [
      { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, position: 1, stepId: 'personal' },
      { key: 'apellido1', label: 'Primer apellido', type: 'text', required: true, position: 2, stepId: 'personal' },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 3, stepId: 'contacto' },
    ],
    documents: [],
    orientations: [],
    mentions: [],
  };

  it('renders progress bar with 5 steps for academic offer and starts at step 1', () => {
    render(<PreinscriptionWizard form={academicOfferForm} onSubmit={vi.fn()} />);

    expect(screen.getAllByText('Datos personales')).toHaveLength(2);
    expect(screen.getByText('Contacto')).toBeInTheDocument();
    expect(screen.getByText('Formación académica')).toBeInTheDocument();
    expect(screen.getByText('Documentación')).toBeInTheDocument();
    expect(screen.getByText('Confirmación y envío')).toBeInTheDocument();

    expect(screen.getByLabelText(/Primer nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primer apellido/i)).toBeInTheDocument();
    // Subsequent steps are not in DOM yet
    expect(screen.queryByLabelText(/Título obtenido/i)).not.toBeInTheDocument();
  });

  it('blocks advance when current step required fields are missing', async () => {
    render(<PreinscriptionWizard form={academicOfferForm} onSubmit={vi.fn()} />);

    // Click "Siguiente →" without filling fields
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    expect(screen.getByText(/El campo Primer nombre es obligatorio/i)).toBeInTheDocument();
    // Stays on step 1
    expect(screen.getByLabelText(/Primer nombre/i)).toBeInTheDocument();
  });

  it('advances through steps, allows navigation back to visited steps, and submits on final confirmation', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const mockUpload = vi.fn().mockResolvedValue({
      token: 'token-cv-1',
      fieldKey: 'cv',
      originalName: 'cv.pdf',
      size: 1024,
      mimeType: 'application/pdf',
    });

    render(
      <PreinscriptionWizard
        form={academicOfferForm}
        onSubmit={handleSubmit}
        onUpload={mockUpload}
      />
    );

    // Step 1: Personal
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Lucía' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Méndez' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 2: Contacto
    expect(screen.getByLabelText(/Correo electrónico/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'lucia@example.com' } });
    fireEvent.change(screen.getByLabelText(/Celular/i), { target: { value: '+59899123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3: Académico
    expect(screen.getByLabelText(/Título obtenido/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Orientación/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mención/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Título obtenido/i), { target: { value: 'Licenciada' } });
    fireEvent.change(screen.getByLabelText(/Orientación/i), { target: { value: 'Educación' } });
    fireEvent.change(screen.getByLabelText(/Mención/i), { target: { value: 'Tecnología Educativa' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 4: Documentos
    expect(screen.getByLabelText(/Curriculum Vitae/i)).toBeInTheDocument();
    // Simulate uploading a file
    const file = new File(['dummy content'], 'cv.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByLabelText(/Curriculum Vitae/i);
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 5: Confirmación y envío
    expect(screen.getByText('Resumen de tus datos')).toBeInTheDocument();
    expect(screen.getByText('Lucía')).toBeInTheDocument();
    expect(screen.getByText('Méndez')).toBeInTheDocument();
    expect(screen.getByText('lucia@example.com')).toBeInTheDocument();
    expect(screen.getByText('Licenciada')).toBeInTheDocument();
    expect(screen.getByText('Educación')).toBeInTheDocument();
    expect(screen.getByText('Tecnología Educativa')).toBeInTheDocument();

    // Verify navigating back via progress button to step 1
    const step1Btn = screen.getByRole('button', { name: /Datos personales/i });
    fireEvent.click(step1Btn);
    expect(screen.getByLabelText(/Primer nombre/i)).toHaveValue('Lucía');

    // Return to confirmation via progress button
    const step5Btn = screen.getByRole('button', { name: /Confirmación y envío/i });
    fireEvent.click(step5Btn);

    // Final submit
    const submitBtn = screen.getByRole('button', { name: /Confirmar y Enviar/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
      const [submittedValues, submittedFiles] = handleSubmit.mock.calls[0] as [Record<string, unknown>, File[]];
      expect(submittedValues.nombre1).toBe('Lucía');
      expect(submittedValues.orientacion).toBe('Educación');
      expect(submittedFiles).toHaveLength(1);
    });
  }, 10000);

  it('renders 4 steps for seminars and does not show orientation or mention fields', () => {
    render(<PreinscriptionWizard form={seminarForm} onSubmit={vi.fn()} />);

    // Check steps: exactly 4 steps
    expect(screen.getAllByText('Datos personales')).toHaveLength(2);
    expect(screen.getByText('Contacto')).toBeInTheDocument();
    expect(screen.getByText('Formación previa')).toBeInTheDocument();
    expect(screen.getByText('Confirmación y envío')).toBeInTheDocument();
    expect(screen.queryByText('Documentación')).not.toBeInTheDocument();

    // Fill step 1
    fireEvent.change(screen.getByLabelText(/Primer nombre/i), { target: { value: 'Carlos' } });
    fireEvent.change(screen.getByLabelText(/Primer apellido/i), { target: { value: 'Silva' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Fill step 2
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'carlos@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Step 3 (Formación previa): verify no orientation/mención fields
    expect(screen.queryByLabelText(/Orientación/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Mención/i)).not.toBeInTheDocument();
  });
});
