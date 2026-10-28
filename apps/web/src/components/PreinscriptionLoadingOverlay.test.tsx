import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreinscriptionLoadingOverlay } from './PreinscriptionLoadingOverlay.js';

describe('PreinscriptionLoadingOverlay', () => {
  it('shows the FLACSO slogan with the highlighted words, the progress message and the warning', () => {
    const { container } = render(<PreinscriptionLoadingOverlay />);

    expect(container.querySelector('.loading-card__slogan')?.textContent).toBe('Formación que conecta, conocimiento que transforma.');
    expect([...container.querySelectorAll('.loading-card__slogan em')].map((em) => em.textContent)).toEqual(['conecta', 'transforma']);
    expect(screen.getByRole('status')).toHaveTextContent('Enviando tu preinscripción…');
    expect(screen.getByText(/Guardando tus datos y documentación en FLACSO Uruguay/i)).toBeInTheDocument();
    expect(screen.getByText('No cierres esta ventana')).toBeInTheDocument();
  });
});
