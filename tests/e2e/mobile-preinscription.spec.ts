import { test, expect } from '@playwright/test';

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`mantiene la preinscripción usable sin overflow a ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const group = page.getByTestId('offer-group-maestria');
    await group.locator('summary').click();
    const target = page.getByTestId('target-card-maestria-genero-c9');
    await target.getByRole('button', { name: /Completar preinscripción/i }).click();

    await expect(page.getByRole('button', { name: /Comenzar preinscripción/i })).toBeVisible();
    await expect(page.locator('#input-nombre1')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('overflow-x', 'hidden');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: /Comenzar preinscripción/i }).click();
    await expect(page.getByText('Paso 1 de')).toBeVisible();
    await expect(page.getByRole('button', { name: /Siguiente/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Siguiente/i })).toHaveCSS('min-height', '44px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: /Siguiente/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const firstErrorLink = page.getByRole('alert').getByRole('link').first();
    await expect(firstErrorLink).toBeVisible();
    await firstErrorLink.click();
    await expect(page.locator('#input-nombre1')).toBeFocused();
  });
}
