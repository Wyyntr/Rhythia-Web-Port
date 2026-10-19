import { expect, test, type Page } from '@playwright/test';
import { buildSspmV1 } from '../tests/builders';

function makeWav(seconds = 4, frequency = 440): Buffer {
  const sampleRate = 44_100;
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((i / sampleRate) * Math.PI * 2 * frequency) * 0.08;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Waits for the game overlay to mount and finish loading its audio/renderer. */
async function waitForGame(page: Page, timeout = 15_000): Promise<void> {
  await page.locator('.game-root').waitFor({ state: 'attached', timeout });
  await expect(page.locator('.loading-layer')).toBeHidden({ timeout });
}

async function importPlayableMap(page: Page, noteTime = 1200, title = 'Browser Test Song'): Promise<void> {
  const bytes = buildSspmV1(
    [
      { time: noteTime, x: 0, y: 0 },
    ],
    {
      id: 'e2e-play',
      mapName: `Test Artist - ${title}`,
      mappers: ['Playwright'],
      difficulty: 1,
      difficultyName: 'Easy',
    },
  );

  await page.locator('input[type=file]').setInputFiles({
    name: 'Browser Test.sspm',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(bytes),
  });

  await expect(page.locator('.map-card')).toHaveCount(1);
  await expect(page.locator('.map-card')).toContainText(title);
}

test('plays a map, hits a note and shows results', async ({ page }) => {
  await page.goto('/');
  await importPlayableMap(page);

  await page.screenshot({ path: 'test-results/library.png', fullPage: true });

  await page.getByRole('button', { name: 'Practice' }).click();
  await waitForGame(page);

  // The centered note maps to the center of the viewport.
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);

  await expect(page.locator('.game-notice')).toContainText('no audio');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/gameplay.png' });

  await expect(page.locator('.hud-score')).not.toHaveText('0', { timeout: 10_000 });
  await expect(page.locator('.results-modal')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/results.png' });

  await page.getByRole('button', { name: 'Map library' }).click();
  await expect(page.locator('.game-root')).toHaveCount(0);
  await expect(page.locator('.map-card .best-row')).toContainText('Best');
  await expect(page.locator('.map-card .best-row')).toContainText('100.00%');
});

test('pauses, resumes and quits an attempt', async ({ page }) => {
  await page.goto('/');
  await importPlayableMap(page, 30_000, 'Pause Test Song');

  await page.getByRole('button', { name: 'Practice' }).click();
  await waitForGame(page);

  await page.locator('.pause-button').click();
  await expect(page.locator('.pause-modal')).toBeVisible();
  await page.screenshot({ path: 'test-results/pause.png' });

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.pause-modal')).toBeHidden();
  await expect(page.locator('.countdown')).toHaveClass(/visible/, { timeout: 3000 });

  await page.waitForTimeout(2200);
  await page.locator('.pause-button').click();
  await expect(page.locator('.pause-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Quit' }).click();

  await expect(page.locator('.game-root')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Rhythia Web' })).toBeVisible();
});

test('keeps imported maps after a reload', async ({ page }) => {
  await page.goto('/');
  await importPlayableMap(page, 1200, 'Persistent Song');

  await page.reload();
  await expect(page.locator('.map-card')).toHaveCount(1);
  await expect(page.locator('.map-card')).toContainText('Persistent Song');
  await expect(page.getByText('1 map', { exact: true })).toBeVisible();
});

test('decodes paired audio and plays with the audio clock', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[type=file]').setInputFiles([
    {
      name: 'Web Audio Test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('v1,1|1|1200'),
    },
    {
      name: 'Web Audio Test.wav',
      mimeType: 'audio/wav',
      buffer: makeWav(),
    },
  ]);

  const card = page.locator('.map-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Audio', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Play' }).click();
  await waitForGame(page);
  await expect(page.locator('.game-notice')).not.toContainText(/without sound|could not/i);

  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect(page.locator('.hud-score')).not.toHaveText('0', { timeout: 12_000 });
});

test('touch aiming applies the finger offset', async ({ page }) => {
  await page.goto('/');
  await importPlayableMap(page, 1200, 'Touch Test Song');

  await page.getByRole('button', { name: 'Practice' }).click();
  await waitForGame(page);

  const size = page.viewportSize()!;
  // Default touch offset is 48 px, so a finger 48 px below the note lands on it.
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      bubbles: true,
    }));
  }, { x: size.width / 2, y: size.height / 2 + 48 });

  await expect(page.locator('.hud-score')).not.toHaveText('0', { timeout: 12_000 });
});
