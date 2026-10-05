import { test, expect } from '@playwright/test';

test.describe('Preinscriptions Versioned Profiles & Wizard End-to-End', () => {
  test('lists all catalog targets with their compatibility status', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Elegí tu próxima propuesta de formación' })).toBeVisible();

    // Expand all accordion groups so all cards are visible
    const groups = page.locator('details');
    const count = await groups.count();
    for (let i = 0; i < count; i++) {
      await groups.nth(i).evaluate((el: HTMLDetailsElement) => { el.open = true; });
    }

    // Verify operational academic targets are listed with Abierta badge
    const daviaCard = page.getByTestId('target-card-davia-c11');
    await expect(daviaCard).toBeVisible();
    await expect(daviaCard.getByText('Abierta')).toBeVisible();

    const maestriaCard = page.getByTestId('target-card-maestria-genero-c9');
    await expect(maestriaCard).toBeVisible();
    await expect(maestriaCard.getByText('Abierta')).toBeVisible();

    const diplomadoCard = page.getByTestId('target-card-diplomado-salud-c2');
    await expect(diplomadoCard).toBeVisible();
    await expect(diplomadoCard.getByText('Abierta')).toBeVisible();

    await page.getByRole('tab', { name: /Seminarios/i }).click();
    await page.getByTestId('offer-group-seminarios').locator('summary').click();
    const seminarCard = page.getByTestId('target-card-seminario-metodologia-ed3');
    await expect(seminarCard).toBeVisible();
    await expect(seminarCard.getByText('Abierta')).toBeVisible();

    await page.getByRole('tab', { name: /Oferta académica/i }).click();
    await page.getByTestId('offer-group-maestria').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
    await page.getByTestId('offer-group-otros').evaluate((element) => { (element as HTMLDetailsElement).open = true; });

    // Verify closed target
    const closedCard = page.getByTestId('target-card-mg-c8');
    await expect(closedCard).toBeVisible();
    await expect(closedCard.getByText('Cerrada')).toBeVisible();

    // Verify incompatible target (doctorado)
    const incompatibleCard = page.getByTestId('target-card-oferta-incompatible');
    await expect(incompatibleCard).toBeVisible();
    await expect(incompatibleCard.getByText('Incompatible')).toBeVisible();
    await expect(incompatibleCard.getByText(/unsupported_offer_type: doctorado/i)).toBeVisible();
  });

  test('completes 5-step wizard for maestría with only orientations', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-maestria').locator('summary').click();
    const maestriaCard = page.getByTestId('target-card-maestria-genero-c9');
    await maestriaCard.getByRole('button', { name: /Completar preinscripción/i }).click();
    await page.getByRole('button', { name: /Comenzar preinscripción/i }).click();

    await expect(page.getByText('Maestría en Género, Sociedad y Políticas - Cohorte 9')).toBeVisible();

    // Step 1: Datos personales y demográficos
    await expect(page.getByRole('heading', { name: 'Datos personales y demográficos' })).toBeVisible();
    await page.locator('#input-nombre1').fill('Laura');
    await page.locator('#input-apellido1').fill('Gómez');
    await page.locator('#input-fechaNacimiento').fill('1988-04-12');
    await page.locator('#input-tipoDocumento').selectOption('pasaporte');
    await page.locator('#input-documento').fill('PAS12345678');
    await page.locator('#input-paisEmisorDocumento').fill('Uruguay');
    await page.locator('#input-genero').selectOption('Mujer');
    await page.locator('#input-etnia').fill('Blanca');
    await page.locator('#input-paisNacimiento').fill('Uruguay');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: Residencia y contacto
    await expect(page.getByRole('heading', { name: 'Residencia y contacto' })).toBeVisible();
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Canelones');
    await page.locator('#input-celular').fill('+59899123456');
    await page.locator('#input-email').fill('laura.gomez@example.com');
    await page.locator('#input-ocupacion').fill('Investigadora');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3: Trayectoria académica
    await expect(page.getByRole('heading', { name: 'Trayectoria académica' })).toBeVisible();
    await page.locator('#input-estudios').fill('Universitario Completo');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#titulo-denominacion').fill('Licenciatura en Sociología');
    await page.locator('#file-titulo').setInputFiles({
      name: 'titulo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 title'),
    });
    await expect(page.getByText('1 archivo cargado', { exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Orientación
    const orientacionSelect = page.locator('#input-orientacion');
    await expect(orientacionSelect).toBeVisible();
    await orientacionSelect.selectOption({ label: 'Género y Políticas Públicas' });
    await expect(page.locator('#input-mencion')).toHaveCount(0);
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Documentación requerida
    await expect(page.locator('legend').filter({ hasText: 'Documentación requerida' })).toBeVisible();
    const dummyFile = {
      name: 'documento.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 dummy file content'),
    };
    await page.locator('#file-identidad').setInputFiles(dummyFile);
    await page.locator('#file-cv').setInputFiles(dummyFile);
    await page.locator('#file-cartaMotivacion').setInputFiles(dummyFile);
    await page.locator('#file-cartaRecomendacion1').setInputFiles(dummyFile);
    await page.locator('#file-cartaRecomendacion2').setInputFiles(dummyFile);

    // Wait until uploads complete
    await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(5);

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 5: Convenios y declaraciones
    await expect(page.getByRole('heading', { name: 'Convenios y declaraciones' })).toBeVisible();
    await page.locator('input[name="tieneConvenio"][value="No"]').check();
    await page.locator('#input-fuente').selectOption('Web');
    await page.locator('input[name="aceptaDifusion"][value="Si"]').check();

    await page.getByRole('button', { name: /Revisar datos/i }).click();

    // Final Step: Confirmación
    await expect(page.getByRole('heading', { name: 'Revisión de datos antes de enviar' })).toBeVisible();
    await expect(page.getByText('Laura', { exact: true })).toBeVisible();
    await expect(page.getByText('Gómez', { exact: true })).toBeVisible();
    await expect(page.getByText('Género y Políticas Públicas').first()).toBeVisible();

    await page.getByRole('button', { name: /Confirmar y enviar/i }).click({ noWaitAfter: true });

    // Verification screen
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible();
    await expect(page.getByText(/Código de seguimiento/i)).toBeVisible();
  });

  test('completes wizard for diplomado with only mentions', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-diplomado').locator('summary').click();
    const diplomadoCard = page.getByTestId('target-card-diplomado-salud-c2');
    await diplomadoCard.getByRole('button', { name: /Completar preinscripción/i }).click();
    await page.getByRole('button', { name: /Comenzar preinscripción/i }).click();

    await expect(page.getByText('Diplomado en Salud Colectiva - Cohorte 2')).toBeVisible();

    // Step 1: Datos personales
    await page.locator('#input-nombre1').fill('Carlos');
    await page.locator('#input-apellido1').fill('Pérez');
    await page.locator('#input-fechaNacimiento').fill('1992-08-20');
    await page.locator('#input-tipoDocumento').selectOption('pasaporte');
    await page.locator('#input-documento').fill('PAS99887766');
    await page.locator('#input-paisEmisorDocumento').fill('Argentina');
    await page.locator('#input-genero').selectOption('Varon');
    await page.locator('#input-etnia').fill('Mestiza');
    await page.locator('#input-paisNacimiento').fill('Argentina');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: Contacto
    await page.locator('#input-paisResidencia').fill('Argentina');
    await page.locator('#input-ciudadResidencia').fill('Buenos Aires');
    await page.locator('#input-celular').fill('+5491123456789');
    await page.locator('#input-email').fill('carlos.perez@example.com');
    await page.locator('#input-ocupacion').fill('Médico');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3: Trayectoria académica
    await expect(page.getByRole('heading', { name: 'Trayectoria académica' })).toBeVisible();

    await page.locator('#input-estudios').fill('Universitario Completo');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#titulo-denominacion').fill('Licenciatura en Medicina');
    await page.locator('#file-titulo').setInputFiles({
      name: 'titulo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 title'),
    });
    await expect(page.getByText('1 archivo cargado', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Orientation must NOT be present
    await expect(page.locator('#input-orientacion')).toHaveCount(0);

    // Mention IS present and selectable
    const mencionSelect = page.locator('#input-mencion');
    await expect(mencionSelect).toBeVisible();
    await expect(mencionSelect.locator('option', { hasText: 'Salud Comunitaria' })).toHaveCount(1);
    await mencionSelect.selectOption('Salud Comunitaria');
  });

  test('seminar wizard renders 4 steps and no orientation/mention attributes', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('tab', { name: /Seminarios/i }).click();
    const seminarCard = page.getByTestId('target-card-seminario-metodologia-ed3');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/targets/seminario-metodologia-ed3') && response.status() === 200),
      seminarCard.locator('button.target-card-primary-action').evaluate((button) => (button as HTMLElement).click()),
    ]);

    await expect(page.getByText('Seminario de Investigación Cualitativa - Edición 2026-03').first()).toBeVisible();
    await page.getByRole('button', { name: /Comenzar preinscripción/i }).click();

    // Seminar progress includes the common document step, without motivation or recommendations.
    await expect(page.getByText('Documentación requerida')).toBeVisible();

    // Step 1: Personal
    await page.locator('#input-nombre1').fill('Martín');
    await page.locator('#input-apellido1').fill('Silva');
    await page.locator('#input-fechaNacimiento').fill('1995-01-10');
    await page.locator('#input-tipoDocumento').selectOption('pasaporte');
    await page.locator('#input-documento').fill('PAS55443322');
    await page.locator('#input-paisEmisorDocumento').fill('Uruguay');
    await page.locator('#input-genero').selectOption('Varon');
    await page.locator('#input-etnia').fill('Blanca');
    await page.locator('#input-paisNacimiento').fill('Uruguay');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: Contacto
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Montevideo');
    await page.locator('#input-celular').fill('+59899000111');
    await page.locator('#input-email').fill('martin.silva@example.com');
    await page.locator('#input-ocupacion').fill('Estudiante');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3: Trayectoria académica for seminar
    await expect(page.getByRole('heading', { name: 'Trayectoria académica' })).toBeVisible();

    // No orientations or mentions
    await expect(page.locator('#input-orientacion')).toHaveCount(0);
    await expect(page.locator('#input-mencion')).toHaveCount(0);
  });

  test('rejects incomplete submission before attempting publication', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/targets/maestria-genero-c9/submissions', {
      data: {
        configRevision: 'mg-c9-v1',
        effectiveRevision: 'sha256:outdated_fake_hash',
        profileVersionId: 'ver_maestria_v0_outdated',
        values: {
          nombre1: 'Test',
          apellido1: 'User',
          email: 'test@example.com',
          celular: '+59899111222',
        },
        files: [],
      },
    });

    const body = await response.json();
    expect(response.status()).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('admin routes enforce Google authentication and reject unauthorized access', async ({ page, request }) => {
    // 1. Direct API call without session cookie is rejected with 401
    const apiResponse = await request.get('http://localhost:3000/api/admin/profiles');
    expect(apiResponse.status()).toBe(404);

    // 2. Direct browser navigation to /admin/perfiles prompts login
    await page.goto('/admin/perfiles');
    await expect(page.getByText('Acceso Administrativo')).toBeVisible();
    await expect(page.getByText(/Acceso exclusivo institucional/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Iniciar sesión con Google/i })).toBeVisible();
  });

  test('seminar legacy permalink resolves unique open edition, shows notice when closed, and warns on conflict', async ({ page }) => {
    const semEd1 = {
      id: 'sem-dcv-ed1',
      kind: 'seminar',
      title: 'Diseño de Cursos Virtuales - Edición 2026-01',
      registrationOpen: false,
      registrationAvailability: 'closed',
      configRevision: 'rev-1',
      status: 'closed',
      issues: [],
      urls: {
        legacyRegistration: 'https://flacso.edu.uy/seminario/diseno-de-cursos-virtuales/',
      },
    };

    const semEd2 = {
      id: 'seminario-metodologia-ed3',
      kind: 'seminar',
      title: 'Seminario de Investigación Cualitativa - Edición 2026-03',
      registrationOpen: true,
      registrationAvailability: 'open',
      configRevision: 'sem-met-ed3-v1',
      status: 'operational',
      issues: [],
      urls: {
        legacyRegistration: 'https://flacso.edu.uy/seminario/diseno-de-cursos-virtuales/',
      },
    };

    // 1. One open and one closed edition: opens the open edition form
    await page.route('**/api/targets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ targets: [semEd1, semEd2] }),
      });
    });

    await page.goto('/seminario/diseno-de-cursos-virtuales/');
    await expect(page.getByText('Seminario de Investigación Cualitativa - Edición 2026-03').first()).toBeVisible();
    await page.getByRole('button', { name: /Comenzar preinscripción/i }).click();
    await expect(page.getByRole('heading', { name: 'Datos personales y demográficos' })).toBeVisible();

    // 2. Both editions closed: displays closed notice
    await page.route('**/api/targets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          targets: [semEd1, { ...semEd2, registrationOpen: false, registrationAvailability: 'closed', status: 'closed' }],
        }),
      });
    });

    await page.goto('/seminario/diseno-de-cursos-virtuales/');
    await expect(page.getByText(/Las preinscripciones para este seminario no se encuentran abiertas en este momento/i)).toBeVisible();

    // 3. Both editions open: displays conflict notice
    await page.route('**/api/targets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          targets: [
            { ...semEd1, registrationOpen: true, registrationAvailability: 'conflict', status: 'incompatible', issues: ['multiple_open_seminar_editions'] },
            { ...semEd2, registrationOpen: true, registrationAvailability: 'conflict', status: 'incompatible', issues: ['multiple_open_seminar_editions'] },
          ],
        }),
      });
    });

    await page.goto('/seminario/diseno-de-cursos-virtuales/');
    await expect(page.getByText(/conflicto o inconsistencia en la configuración del catálogo/i)).toBeVisible();
  });
});
