/**
 * Screenshots of every screen at desktop and phone size, light and dark. Written to
 * `e2e/screenshots/` (or $SCREENS_DIR). Also a cheap layout check: no horizontal overflow.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { addFiles, addFilesAndWait, cards, expect, openApp, pressKeys, ROOT, test } from './support';

const DIR = process.env.SCREENS_DIR ?? path.join(ROOT, 'e2e', 'screenshots');
mkdirSync(DIR, { recursive: true });

const DESKTOP = { width: 1366, height: 860 };
const PHONE = { width: 360, height: 780 };

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage, animations: 'disabled' });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll, 'page should not scroll horizontally').toBeLessThanOrEqual(overflow.client);
}

async function theme(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
}

for (const [device, viewport] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(device, () => {
    test.use({ viewport });

    test(`empty state (${device})`, async ({ page }) => {
      await openApp(page);
      await theme(page, 'light');
      await shot(page, `${device}-empty-light`, true);
      await expectNoHorizontalOverflow(page);
      await theme(page, 'dark');
      await shot(page, `${device}-empty-dark`, true);
    });

    test(`demo review, dialogs (${device})`, async ({ page }) => {
      await openApp(page, '?demo');
      await expect(page.locator('.review')).toBeVisible();
      await theme(page, 'light');
      await shot(page, `${device}-review-light`);
      await expectNoHorizontalOverflow(page);
      if (device === 'phone') {
        await page.locator('.summary__head').click();
        await shot(page, `${device}-review-summary-open-light`);
        await expectNoHorizontalOverflow(page);
      }
      await theme(page, 'dark');
      await shot(page, `${device}-review-dark`);
      await theme(page, 'light');

      await cards(page).nth(3).locator('.page-card__badge').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `${device}-number-editor-light`);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');

      await cards(page).nth(3).locator('.page-card__open').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `${device}-lightbox-light`);
      await expectNoHorizontalOverflow(page);
      await theme(page, 'dark');
      await shot(page, `${device}-lightbox-dark`);
      await page.keyboard.press('Escape');
      await theme(page, 'light');

      const first = cards(page).first();
      await first.getByRole('button', { name: /^Move / }).focus();
      await pressKeys(page, ['Space', 'ArrowRight', 'Space']);
      await expect(page.locator('.page-grid__manual')).toBeVisible();
      await shot(page, `${device}-manual-order-light`);
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Remove duplicate scans' }).click();
      await expect(page.locator('.toast')).toBeVisible();
      await shot(page, `${device}-toast-undo-light`);
      await expectNoHorizontalOverflow(page);
    });

    test(`processing and export dialog (${device})`, async ({ page }) => {
      await openApp(page);
      await theme(page, 'light');
      await addFiles(page, ['big-shuffled-240.pdf']);
      await expect(cards(page).nth(6)).toBeVisible({ timeout: 60_000 });
      await shot(page, `${device}-processing-light`);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.locator('.processing--stopped')).toBeVisible({ timeout: 15_000 });
      await shot(page, `${device}-stopped-light`);
      await page.getByRole('button', { name: 'Start over' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Start over' }).click();
      await expect(page.locator('.empty')).toBeVisible();

      await addFilesAndWait(page, ['shuffled-missing7-dup4.pdf']);
      await shot(page, `${device}-real-review-light`);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Download sorted PDF' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `${device}-export-confirm-light`);
      await expectNoHorizontalOverflow(page);
      await theme(page, 'dark');
      await shot(page, `${device}-export-confirm-dark`);
      await page.keyboard.press('Escape');
    });
  });
}
