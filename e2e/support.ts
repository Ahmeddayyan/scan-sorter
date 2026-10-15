/**
 * Shared Playwright fixtures and helpers.
 *
 * `test` extends the base test with an automatic guard that
 *   - blocks every request whose origin is not the app's own origin and fails the test if one
 *     was attempted (the privacy promise: no third-party requests at runtime), and
 *   - fails the test on any uncaught page error, console error or console warning.
 */
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { expect };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'test-fixtures', 'generated');
export const fixture = (name: string): string => path.join(FIXTURES, name);
export const hasScanFixtures = (): boolean => existsSync(fixture('scan-only-1-10.pdf'));

export interface Guard {
  /** Every request URL the browser made (same-origin ones included), in order. */
  requests: string[];
  foreign: string[];
  consoleIssues: string[];
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, page, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      const guard: Guard = { requests: [], foreign: [], consoleIssues: [] };
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        guard.requests.push(url);
        if (new URL(url).origin !== origin) {
          guard.foreign.push(url);
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      page.on('console', (message) => {
        const type = message.type();
        if (type === 'error' || type === 'warning') guard.consoleIssues.push(`${type}: ${message.text()}`);
      });
      page.on('pageerror', (error) => guard.consoleIssues.push(`pageerror: ${error.message}`));
      await use(guard);
      expect.soft(guard.foreign, 'requests to a foreign origin (privacy promise)').toEqual([]);
      expect.soft(guard.consoleIssues, 'console errors / warnings / page errors').toEqual([]);
    },
    { auto: true },
  ],
});

// ---------------------------------------------------------------------------
// App helpers
// ---------------------------------------------------------------------------

export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('.app-header .brand')).toBeVisible();
}

/** Add files through the (hidden) file input - the same code path as the picker and drop. */
export async function addFiles(page: Page, names: string[]): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles(names.map(fixture));
}

/** Wait until the pipeline has finished (or was stopped) and the review screen is settled. */
export async function waitForRun(page: Page, timeout = 150_000): Promise<void> {
  await expect(page.locator('.review')).toBeVisible();
  await expect(page.locator('.processing:not(.processing--stopped)')).toBeHidden({ timeout });
  await expect(page.locator('.summary__headline strong')).not.toHaveText(/Reading/, { timeout: 10_000 });
}

export async function addFilesAndWait(page: Page, names: string[], timeout?: number): Promise<void> {
  await addFiles(page, names);
  await expect(page.locator('.review')).toBeVisible();
  await waitForRun(page, timeout);
}

export const tiles = (page: Page): Locator => page.locator('.page-grid__list > li');
export const cards = (page: Page): Locator => page.locator('.page-grid__list > li.page-card');
export const gaps = (page: Page): Locator => page.locator('.page-grid__list > li.gap-tile');

/** Badge texts of the page cards in grid order, e.g. ["p. 1", "p. 2", "?"]. */
export async function badgeTexts(page: Page): Promise<string[]> {
  return cards(page).locator('.page-card__badge .num').allInnerTexts();
}

/** Page numbers in grid order without the "p. " prefix, e.g. ["1", "2", "?"]. */
export async function numbersInOrder(page: Page): Promise<string[]> {
  return (await badgeTexts(page)).map((t) => t.replace(/^p\.\s*/, ''));
}

export async function gapTexts(page: Page): Promise<string[]> {
  return gaps(page).locator('.gap-tile__title').allInnerTexts();
}

export async function labelsInOrder(page: Page): Promise<string[]> {
  return cards(page).locator('.page-card__meta').allInnerTexts();
}

export const headline = (page: Page): Locator => page.locator('.summary__headline strong');

export const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/** Press keys one by one with a short pause, like a person would (dnd-kit re-measures between moves). */
export async function pressKeys(page: Page, keys: string[], delay = 150): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(delay);
  }
}
