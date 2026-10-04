import { test, expect } from '@playwright/test';

test.describe('Document Flow End-to-End', () => {
  const dummyPdf = {
    name: 'documento.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 dummy test document content'),
  };

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('response', async (res) => {
      if (res.url().includes('/api/')) {
        console.log('API RESPONSE:', res.url(), res.status());
        if (res.status() >= 400) {
          try {
            console.log('ERROR BODY:', await res.text());
          } catch {}
        }
      }
    });
  });

  test('Flow 1: completes non-master offer with identity, CV, title and motivation', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-diploma').locator('summary').click();
    const daviaCard = page.getByTestId('target-card-davia-c11');
    await daviaCard.getByRole('button', { name: /Completar preinscripción/i }).click();

    await expect(page.getByText(/Diploma Superior en Aprendizaje Visual e Inteligencia Artificial/i)).toBeVisible();

    // Step 1: Datos personales
    await page.locator('#input-nombre1').fill('Ana');
    await page.locator('#input-apellido1').fill('Pérez');
    await page.locator('#input-fechaNacimiento').fill('1990-01-01');
    await page.locator('#input-tipoDocumento').selectOption('cedula_uruguaya');
    await page.locator('#input-documento').fill('34567894');
    await page.locator('#input-genero').selectOption('Mujer');
    await page.locator('#input-etnia').fill('No declara');
    await page.locator('#input-paisNacimiento').fill('Uruguay');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: Residencia y contacto
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Montevideo');
    await page.locator('#input-celular').fill('99123456');
    await page.locator('#input-email').fill('ana.perez@example.com');
    await page.locator('#input-ocupacion').fill('Docente');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3: Trayectoria académica
    await page.locator('#input-estudios').fill('Licenciatura');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#input-institucion').fill('UdelaR');

    // Select orientation and mention
    await page.locator('#input-orientacion').selectOption('Educación');
    await page.locator('#input-mencion').selectOption('Tecnología Educativa');

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Documentación
    await expect(page.getByRole('heading', { name: 'Documentación requerida' })).toBeVisible();
    await page.locator('#file-identidad').setInputFiles(dummyPdf);
    await page.locator('#file-cv').setInputFiles(dummyPdf);

    // Title companion field and file
    await page.locator('#titulo-denominacion').fill('Licenciada en Educación');
    await page.locator('#file-titulo').setInputFiles(dummyPdf);

    // Motivation letter
    await page.locator('#file-cartaMotivacion').setInputFiles(dummyPdf);

    // Wait for uploads to complete
    await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(4);

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 5: Convenios y declaraciones (Final step in 5-step wizard)
    await page.locator('input[name="tieneConvenio"][value="No"]').check();
    await page.locator('#input-fuente').selectOption('Web');
    await page.locator('input[name="aceptaDifusion"][value="Si"]').check();

    await page.getByRole('button', { name: /Confirmar y Enviar/i }).click();

    // Success screen
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible({ timeout: 15000 });
  });

  test('Flow 2: completes master offer with recommendations attached now', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-maestria').locator('summary').click();
    const maestriaCard = page.getByTestId('target-card-maestria-genero-c9');
    await maestriaCard.getByRole('button', { name: /Completar preinscripción/i }).click();

    // Step 1
    await page.locator('#input-nombre1').fill('Laura');
    await page.locator('#input-apellido1').fill('Gómez');
    await page.locator('#input-fechaNacimiento').fill('1988-04-12');
    await page.locator('#input-tipoDocumento').selectOption('cedula_uruguaya');
    await page.locator('#input-documento').fill('34567894');
    await page.locator('#input-genero').selectOption('Mujer');
    await page.locator('#input-etnia').fill('No declara');
    await page.locator('#input-paisNacimiento').fill('Uruguay');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Montevideo');
    await page.locator('#input-celular').fill('99123456');
    await page.locator('#input-email').fill('laura.gomez@example.com');
    await page.locator('#input-ocupacion').fill('Investigadora');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3
    await page.locator('#input-estudios').fill('Universitario Completo');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#input-institucion').fill('UdelaR');
    await page.locator('#input-orientacion').selectOption('Género y Políticas Públicas');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Documentation including recommendation letters attached now
    await page.locator('#file-identidad').setInputFiles(dummyPdf);
    await page.locator('#file-cv').setInputFiles(dummyPdf);
    await page.locator('#titulo-denominacion').fill('Licenciatura en Sociología');
    await page.locator('#file-titulo').setInputFiles(dummyPdf);
    await page.locator('#file-cartaMotivacion').setInputFiles(dummyPdf);

    // Recommendation letters - choose Adjuntar ahora (default) and upload
    await page.locator('#file-cartaRecomendacion1').setInputFiles(dummyPdf);
    await page.locator('#file-cartaRecomendacion2').setInputFiles(dummyPdf);

    await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(6);
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 5: Final step
    await page.locator('input[name="tieneConvenio"][value="No"]').check();
    await page.locator('#input-fuente').selectOption('Web');
    await page.locator('input[name="aceptaDifusion"][value="Si"]').check();

    await page.getByRole('button', { name: /Confirmar y Enviar/i }).click();
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible({ timeout: 15000 });
  });

  test('Flow 3: completes master offer with recommendations marked for later submission', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-maestria').locator('summary').click();
    const maestriaCard = page.getByTestId('target-card-maestria-genero-c9');
    await maestriaCard.getByRole('button', { name: /Completar preinscripción/i }).click();

    // Step 1
    await page.locator('#input-nombre1').fill('Martina');
    await page.locator('#input-apellido1').fill('Silva');
    await page.locator('#input-fechaNacimiento').fill('1991-03-10');
    await page.locator('#input-tipoDocumento').selectOption('cedula_uruguaya');
    await page.locator('#input-documento').fill('34567894');
    await page.locator('#input-genero').selectOption('Mujer');
    await page.locator('#input-etnia').fill('No declara');
    await page.locator('#input-paisNacimiento').fill('Uruguay');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Montevideo');
    await page.locator('#input-celular').fill('99123456');
    await page.locator('#input-email').fill('martina.silva@example.com');
    await page.locator('#input-ocupacion').fill('Investigadora');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3
    await page.locator('#input-estudios').fill('Universitario Completo');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#input-institucion').fill('UdelaR');
    await page.locator('#input-orientacion').selectOption('Género y Políticas Públicas');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Documentation with deferred recommendations
    await page.locator('#file-identidad').setInputFiles(dummyPdf);
    await page.locator('#file-cv').setInputFiles(dummyPdf);
    await page.locator('#titulo-denominacion').fill('Licenciatura en Psicología');
    await page.locator('#file-titulo').setInputFiles(dummyPdf);
    await page.locator('#file-cartaMotivacion').setInputFiles(dummyPdf);

    // Select "Adjuntar posteriormente" for recommendations
    await page.locator('input[name="choice-cartaRecomendacion1"]').nth(1).check();
    await page.locator('input[name="choice-cartaRecomendacion2"]').nth(1).check();

    await expect(page.getByText('Marcado para entrega posterior.')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(4);

    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 5: Final step
    await page.locator('input[name="tieneConvenio"][value="No"]').check();
    await page.locator('#input-fuente').selectOption('Web');
    await page.locator('input[name="aceptaDifusion"][value="Si"]').check();

    await page.getByRole('button', { name: /Confirmar y Enviar/i }).click();
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible({ timeout: 15000 });
  });

  test('Flow 4: completes seminar with title absence declaration and no motivation/recommendation', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('offer-group-seminarios').locator('summary').click();
    const seminarCard = page.getByTestId('target-card-seminario-metodologia-ed3');
    await seminarCard.getByRole('button', { name: /Completar preinscripción/i }).click();

    // Step 1
    await page.locator('#input-nombre1').fill('Mateo');
    await page.locator('#input-apellido1').fill('Rodríguez');
    await page.locator('#input-fechaNacimiento').fill('1995-11-20');
    await page.locator('#input-tipoDocumento').selectOption('cedula_uruguaya');
    await page.locator('#input-documento').fill('34567894');
    await page.locator('#input-genero').selectOption('Varon');
    await page.locator('#input-etnia').fill('No declara');
    await page.locator('#input-paisNacimiento').fill('Uruguay');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2
    await page.locator('#input-paisResidencia').fill('Uruguay');
    await page.locator('#input-ciudadResidencia').fill('Montevideo');
    await page.locator('#input-celular').fill('99123456');
    await page.locator('#input-email').fill('mateo.rodriguez@example.com');
    await page.locator('#input-ocupacion').fill('Estudiante');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 3
    await page.locator('#input-estudios').fill('Terciario');
    await page.locator('input[name="posgradoFlacso"][value="No"]').check();
    await page.locator('#input-institucion').fill('IPA');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 4: Documentation - check "No poseo actualmente título", no motivation letter
    await page.locator('#file-identidad').setInputFiles(dummyPdf);
    await page.locator('#file-cv').setInputFiles(dummyPdf);

    // Check no title
    await page.locator('#toggle-sin-titulo').check();
    await expect(page.locator('#titulo-denominacion')).toHaveCount(0);
    await expect(page.locator('#file-titulo')).toHaveCount(0);

    // Verify motivation letter is NOT present for seminars
    await expect(page.locator('#file-cartaMotivacion')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Quitar' })).toHaveCount(2);
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 5: Final step
    await page.locator('input[name="tieneConvenio"][value="No"]').check();
    await page.locator('#input-fuente').selectOption('Web');
    await page.locator('input[name="aceptaDifusion"][value="Si"]').check();

    await page.getByRole('button', { name: /Confirmar y Enviar/i }).click();
    await expect(page.getByText('¡Preinscripción enviada con éxito!')).toBeVisible({ timeout: 15000 });
  });
});
