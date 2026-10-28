import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DiagnosticTarget, FormDefinition } from '@flacso/contracts';
import { App } from './App.js';
import { apiClient } from './api/client.js';

vi.mock('./api/client.js', async () => {
  const actual = await vi.importActual<typeof import('./api/client.js')>('./api/client.js');
  return {
    ...actual,
    apiClient: {
      listTargets: vi.fn(),
      getTarget: vi.fn(),
      submit: vi.fn(),
      getAdminMe: vi.fn(),
      adminLogin: vi.fn(),
      adminLogout: vi.fn(),
    },
  };
});

describe('App legacy registration routes', () => {
  const target: DiagnosticTarget = {
    id: 'maestria-genero-c6',
    kind: 'academic_offer',
    title: 'Maestría en Género — Cohorte VI',
    registrationOpen: true,
    configRevision: 'revision-1',
    status: 'operational',
    issues: [],
    urls: {
      legacyRegistration: 'https://preinscripciones.flacso.edu.uy/oferta/maestria-en-genero/',
    },
  };

  const form: FormDefinition = {
    targetId: target.id,
    kind: target.kind,
    offerType: 'maestria',
    title: target.title,
    registrationOpen: true,
    configRevision: target.configRevision,
    effectiveRevision: target.configRevision,
    profileVersionId: 'ver_maestria_v1',
    steps: [{ id: 'personal', title: 'Personal', order: 1 }],
    inputs: [],
    documents: [],
    orientations: [],
    mentions: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.getAdminMe).mockRejectedValue(new Error('Unauthorized'));
    window.history.replaceState({}, '', '/oferta/maestria-en-genero/');
  });

  it('opens the matching form from the previous platform path', async () => {
    vi.mocked(apiClient.listTargets).mockResolvedValue([target]);
    vi.mocked(apiClient.getTarget).mockResolvedValue(form);

    render(<App />);

    await waitFor(() => {
      expect(apiClient.getTarget).toHaveBeenCalledWith(target.id);
    });

    expect(await screen.findByRole('heading', { name: target.title })).toBeInTheDocument();
  });

  it('uses the previous platform path after selecting a target', async () => {
    window.history.replaceState({}, '', '/');
    vi.mocked(apiClient.listTargets).mockResolvedValue([target]);
    vi.mocked(apiClient.getTarget).mockResolvedValue(form);

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Completar preinscripción' }));

    expect(window.location.pathname).toBe('/oferta/maestria-en-genero/');
    await waitFor(() => {
      expect(apiClient.getTarget).toHaveBeenCalledWith(target.id);
    });
  });

  it('renders the Google OAuth callback as the administrative login route', async () => {
    window.history.replaceState({}, '', '/accounts/google/login/callback/');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Acceso Administrativo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión con Google (FLACSO)' })).toBeInTheDocument();
  });

  it('retains persistent admin login when visiting /admin/perfiles with an active session', async () => {
    window.history.replaceState({}, '', '/admin/perfiles');
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({
      user: {
        email: 'web@flacso.edu.uy',
        name: 'Webmaster FLACSO',
        role: 'admin',
      },
      csrfToken: 'csrf-persistent-token',
    });

    render(<App />);

    expect(await screen.findByText('Administración de Preinscripciones')).toBeInTheDocument();
    expect(screen.getByText('web@flacso.edu.uy')).toBeInTheDocument();
  });

  it('renders login page when visiting /admin/perfiles with expired or absent session', async () => {
    window.history.replaceState({}, '', '/admin/perfiles');
    vi.mocked(apiClient.getAdminMe).mockRejectedValue(new Error('Unauthorized'));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Acceso Administrativo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión con Google (FLACSO)' })).toBeInTheDocument();
  });

  describe('seminar permalink resolution in App', () => {
    const closedSeminar: DiagnosticTarget = {
      id: 'sem-ed1',
      kind: 'seminar',
      title: 'Seminario Cualitativo Edición 1',
      registrationOpen: false,
      registrationAvailability: 'closed',
      configRevision: 'rev-1',
      status: 'closed',
      issues: [],
      urls: {
        legacyRegistration: 'https://flacso.edu.uy/seminario/investigacion-cualitativa/',
      },
    };

    const openSeminar: DiagnosticTarget = {
      id: 'sem-ed2',
      kind: 'seminar',
      title: 'Seminario Cualitativo Edición 2',
      registrationOpen: true,
      registrationAvailability: 'open',
      configRevision: 'rev-2',
      status: 'operational',
      issues: [],
      urls: {
        legacyRegistration: 'https://flacso.edu.uy/seminario/investigacion-cualitativa/',
      },
    };

    const seminarForm: FormDefinition = {
      targetId: openSeminar.id,
      kind: 'seminar',
      offerType: 'seminar',
      title: openSeminar.title,
      registrationOpen: true,
      configRevision: openSeminar.configRevision,
      effectiveRevision: openSeminar.configRevision,
      profileVersionId: 'ver_seminar_v1',
      steps: [{ id: 'personal', title: 'Personal', order: 1 }],
      inputs: [],
      documents: [],
      orientations: [],
      mentions: [],
    };

    it('loads the open edition when both open and closed editions exist for the path', async () => {
      window.history.replaceState({}, '', '/seminario/investigacion-cualitativa/');
      vi.mocked(apiClient.listTargets).mockResolvedValue([closedSeminar, openSeminar]);
      vi.mocked(apiClient.getTarget).mockResolvedValue(seminarForm);

      render(<App />);

      await waitFor(() => {
        expect(apiClient.getTarget).toHaveBeenCalledWith(openSeminar.id);
      });
      expect(await screen.findByRole('heading', { name: openSeminar.title })).toBeInTheDocument();
    });

    it('shows closed notice and does not call getTarget when all editions are closed', async () => {
      window.history.replaceState({}, '', '/seminario/investigacion-cualitativa/');
      vi.mocked(apiClient.listTargets).mockResolvedValue([closedSeminar]);

      render(<App />);

      expect(await screen.findByText(/Las preinscripciones para esta propuesta no se encuentran abiertas/i)).toBeInTheDocument();
      expect(apiClient.getTarget).not.toHaveBeenCalled();
    });

    it('shows conflict notice and does not call getTarget when two editions are open', async () => {
      window.history.replaceState({}, '', '/seminario/investigacion-cualitativa/');
      const openSeminar1 = { ...closedSeminar, registrationOpen: true, registrationAvailability: 'open' as const };
      vi.mocked(apiClient.listTargets).mockResolvedValue([openSeminar1, openSeminar]);

      render(<App />);

      expect(await screen.findByText(/conflicto/i)).toBeInTheDocument();
      expect(apiClient.getTarget).not.toHaveBeenCalled();
    });
  });
});
