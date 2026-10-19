import { expect, test } from '@playwright/test';
import { buildRhm, buildSspmV2 } from '../tests/builders';

test('imports an SSPM v2 map into the library', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rhythia Web' })).toBeVisible();

  const bytes = buildSspmV2(
    [
      { time: 1000, x: -1, y: 1 },
      { time: 2000, x: 0, y: 0 },
      { time: 3000, x: 1, y: -1 },
    ],
    {
      id: 'e2e-sspm',
      mapName: 'E2E Artist - E2E Song',
      mappers: ['Playwright'],
      difficulty: 3,
      difficultyName: 'Hard',
      starRating: 9,
    },
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'E2E Map.sspm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });

  const card = page.locator('.map-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('E2E Song');
  await expect(card).toContainText('E2E Artist');
  await expect(card).toContainText('SSPM v2');
  await expect(card).toContainText('Hard');
  await expect(card).toContainText('Playwright');
  await expect(page.getByText('1 map', { exact: true })).toBeVisible();
});

test('imports an RHM map', async ({ page }) => {
  await page.goto('/');

  const bytes = buildRhm(
    [
      { time: 500, x: 0.5, y: 0 },
      { time: 1500, x: 0, y: 1 },
    ],
    { title: 'RHM Artist - RHM Song', difficultyName: 'Custom' },
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'E2E Map.rhm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });

  const card = page.locator('.map-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('RHM Song');
  await expect(card).toContainText('RHM');
  await expect(card).toContainText('Custom');
});

test('pairs audio with a legacy TXT map', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type=file]').setInputFiles([
    {
      name: 'Legacy Song.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('v1,0|2|100,2|0|250,1|1|175'),
    },
    {
      name: 'Legacy Song.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]),
    },
  ]);

  const card = page.locator('.map-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Legacy Song');
  await expect(card).toContainText('TXT');
  await expect(card.getByText('Audio', { exact: true })).toBeVisible();
});

test('reports unsupported or broken files', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type=file]').setInputFiles([
    {
      name: 'broken.sspm',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([1, 2, 3, 4, 5]),
    },
    {
      name: 'notes.docx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([1, 2, 3]),
    },
  ]);

  const errors = page.locator('.errors');
  await expect(errors).toBeVisible();
  await expect(errors).toContainText('broken.sspm');
  await expect(errors).toContainText('notes.docx');
});
