import { expect, test } from '@playwright/test';
import { buildSspmV1 } from '../tests/builders';

test('loads, imports, plays and reloads while offline', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Rhythia Web' })).toBeVisible();

  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  // With a prompt-style registration the first page is not controlled until
  // it reloads; afterwards all app requests are served by the worker.
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const bytes = buildSspmV1(
    [{ time: 1200, x: 0, y: 0 }],
    {
      id: 'pwa-offline',
      mapName: 'Offline Artist - Offline Song',
      difficulty: 1,
      difficultyName: 'Easy',
    },
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'Offline Song.sspm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.map-card')).toHaveCount(1);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Rhythia Web' })).toBeVisible();
  await expect(page.locator('.map-card')).toContainText('Offline Song');

  await page.getByRole('button', { name: 'Practice' }).click();
  await page.locator('.game-root').waitFor({ state: 'attached' });
  await expect(page.locator('.loading-layer')).toBeHidden({ timeout: 30_000 });

  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect(page.locator('.hud-score')).not.toHaveText('0', { timeout: 12_000 });
});
