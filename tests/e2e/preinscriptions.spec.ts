import { test, expect } from '@playwright/test';

test.describe('Preinscriptions MVP End-to-End', () => {
  test('complete flow: list targets, submit dynamic form, and view confirmation', async ({ page }) => {
    // 1. Visit Home
    await page.goto('/');

    // 2. Verify targets are listed
    await expect(page.getByText('Preinscripciones FLACSO Uruguay')).toBeVisible();
    await expect(page.getByText(/Aprendizaje Visual/i)).toBeVisible();
    await expect(page.getByText('Maestría en Género, Sociedad y Políticas - Cohorte 8')).toBeVisible();

    // 3. Open DAVIA form
    const daviaCard = page.getByTestId('target-card-davia-c11');
    await daviaCard.getByRole('button', { name: /Completar preinscripción/i }).click();

    // 4. Verify dynamic form inputs are visible
    await expect(page.getByLabel(/Nombre/i)).toBeVisible();
    await expect(page.getByLabel(/Correo electrónico/i)).toBeVisible();
    await expect(page.getByLabel(/Documento/i)).toBeVisible();
    await expect(page.getByLabel(/Orientación/i)).toBeVisible();

    // 5. Fill inputs
    await page.getByLabel(/Nombre/i).fill('Mariana');
    await page.getByLabel(/Apellido/i).fill('García');
    await page.getByLabel(/Correo electrónico/i).fill('mariana.garcia@example.com');
    await page.getByLabel(/Teléfono/i).fill('099123456');
    await page.getByLabel(/Documento/i).fill('4.876.543-2');
    await page.getByLabel(/Fecha de nacimiento/i).fill('1994-06-18');
    await page.getByLabel(/Título/i).fill('Licenciada en Sociología');

    // 6. Select orientation and dependent mention
    await page.getByLabel(/Orientación/i).selectOption('educacion');
    await expect(page.getByLabel(/Mención/i)).toBeVisible();
    await page.getByLabel(/Mención/i).selectOption('tec-edu');

    // 7. Submit form
    await page.getByRole('button', { name: /Enviar preinscripción/i }).click();

    // 8. Verify confirmation
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible();
    await expect(page.getByText(/Código de seguimiento:/i)).toBeVisible();

    // 9. Back to home and verify closed target
    await page.getByRole('button', { name: /Volver a la lista de destinos/i }).click();
    await expect(page.getByText('Maestría en Género, Sociedad y Políticas - Cohorte 8')).toBeVisible();

    const mgCard = page.getByTestId('target-card-mg-c8');
    await mgCard.getByRole('button', { name: /Ver información del destino/i }).click();
    await expect(page.getByText(/Preinscripción cerrada/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Inscripción cerrada/i })).toBeDisabled();
  });

  test('admin flow: login, view integration health, and diagnose target', async ({ page }) => {
    // 1. Visit Home and click Panel de Diagnóstico
    await page.goto('/');
    await page.getByRole('button', { name: /Panel de Diagnóstico/i }).click();

    // 2. See login form
    await expect(page.getByText('Acceso Administrativo')).toBeVisible();

    // 3. Fill admin credentials
    await page.getByLabel(/Usuario/i).fill('admin');
    await page.getByLabel(/Contraseña/i).fill('flacso_admin_2026');
    await page.getByRole('button', { name: /Iniciar Sesión/i }).click();

    // 4. Verify dashboard is displayed
    await expect(page.getByText('Panel de Diagnóstico y Administración')).toBeVisible();
    await expect(page.getByText('Estado de Integraciones')).toBeVisible();
    await expect(page.getByText('Formularios Detectados')).toBeVisible();
    await expect(page.getByText(/Aprendizaje Visual/i)).toBeVisible();

    // 5. Trigger live diagnostic modal
    const daviaRow = page.locator('tr', { hasText: 'davia-c11' });
    await daviaRow.getByRole('button', { name: /Diagnosticar/i }).click();

    // 6. Verify modal contents
    const modal = page.locator('div.fixed');
    await expect(modal.getByText(/WordPress REST v1/i)).toBeVisible();
    await expect(modal.getByRole('heading', { name: /Google Sheets/i })).toBeVisible();
    await expect(modal.getByRole('heading', { name: /Google Drive/i })).toBeVisible();

    // 7. Close modal
    await modal.getByLabel('Cerrar').click();

    // 8. Logout
    await page.getByRole('button', { name: /Cerrar Sesión/i }).click();
    await expect(page.getByText(/Preinscripciones FLACSO Uruguay/i)).toBeVisible();
  });
});
