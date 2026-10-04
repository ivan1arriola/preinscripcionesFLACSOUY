import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminLoginPage } from './AdminLoginPage.js';

describe('AdminLoginPage', () => {
  it('uses a compact, explicitly sized Google mark in the administrative access card', () => {
    const { container } = render(<AdminLoginPage onLoginSuccess={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Acceso Administrativo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión con Google (FLACSO)' })).toBeInTheDocument();
    expect(container.querySelector('.admin-login-card')).toBeInTheDocument();
    expect(container.querySelector('.google-sign-in-mark')).toHaveAttribute('width', '20');
    expect(container.querySelector('.google-sign-in-mark')).toHaveAttribute('height', '20');
  });
});
