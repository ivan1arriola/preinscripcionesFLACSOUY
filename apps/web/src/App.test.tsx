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
});
