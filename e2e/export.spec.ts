/** Download the sorted PDF and verify it in Node. */
import path from 'node:path';
import type { Page } from '@playwright/test';
import { addFilesAndWait, cards, expect, hasScanFixtures, headline, openApp, range, test } from './support';
import { inspectPdf, printedNumber } from './verify-pdf';

/**
 * Click "Download sorted PDF", go through the "Download anyway?" confirmation when the report
 * has warnings (`confirm` says whether it is expected), and save the download.
 */
async function download(page: Page, confirm: boolean): Promise<{ file: string; name: string }> {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download sorted PDF' }).click();
  const dialog = page.getByRole('dialog');
  if (confirm) {
    await expect(dialog.getByRole('heading', { name: 'Download anyway?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Download anyway' }).click();
  } else {
    await expect(dialog).toBeHidden();
  }
  const dl = await waiting;
  const file = path.join(test.info().outputPath(), dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename() };
}

test('export: duplicates removed, a page rotated, missing page confirmed, order verified', async ({ page }) => {
  await openApp(page);
  await addFilesAndWait(page, ['shuffled-missing7-dup4.pdf']);
  await page.getByRole('button', { name: 'Remove duplicate scans' }).click();
  await expect(cards(page)).toHaveCount(11);
  // rotate page "2" (second card) a quarter turn
  await cards(page).nth(1).getByRole('button', { name: /^Rotate/ }).click();

  const { file, name } = await download(page, true);
  expect(name).toBe('shuffled-missing7-dup4-sorted.pdf');
  await expect(page.locator('.toast--success')).toContainText('Saved shuffled-missing7-dup4-sorted.pdf (11 pages)');

  const pages = await inspectPdf(file);
  expect(pages).toHaveLength(11);
  expect(pages.map(printedNumber)).toEqual(['1', '2', '3', '4', '5', '6', '8', '9', '10', '11', '12']);
  expect(pages.map((p) => p.rotation)).toEqual([0, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // text/vector content copied as-is: the decoy header survives
  expect(pages[0].text).toContain('Chapter 2');
});

test('export without warnings downloads straight away', async ({ page }) => {
  await openApp(page);
  await addFilesAndWait(page, ['book-alternating-21-36.pdf']);
  const { file, name } = await download(page, false);
  expect(name).toBe('book-alternating-21-36-sorted.pdf');
  const pages = await inspectPdf(file);
  expect(pages.map(printedNumber)).toEqual(range(21, 36));
});

test.describe('export with OCR inputs', () => {
  test.skip(!hasScanFixtures(), 'scan fixtures need @napi-rs/canvas (npm run fixtures)');

  test('image-only PDF: pages copied in the sorted order', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['scan-only-1-10.pdf']);
    const { file, name } = await download(page, false);
    expect(name).toBe('scan-only-1-10-sorted.pdf');
    const pages = await inspectPdf(file);
    expect(pages.map((p) => p.testPage)).toEqual(range(1, 10).map(Number));
    expect(pages.every((p) => p.hasImage)).toBe(true);
  });

  test('photos become upright A4 image pages, before the PDF pages', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['book-alternating-21-36.pdf', 'photo-p3.webp', 'photo-p2-exif6.jpg', 'photo-p1.png']);
    await expect(headline(page)).toHaveText('17 pages missing');
    // rotate the WebP (page 3) so a rotated image page is covered too
    await cards(page).nth(2).getByRole('button', { name: /^Rotate/ }).click();
    const { file, name } = await download(page, true); // 4-20 missing -> confirm
    expect(name).toBe('book-alternating-21-36-sorted.pdf');
    const pages = await inspectPdf(file);
    expect(pages).toHaveLength(19);
    for (const p of pages.slice(0, 3)) {
      expect(p.hasImage).toBe(true);
      expect(p.width).toBeCloseTo(595.28, 0);
      expect(p.height).toBeCloseTo(841.89, 0);
      expect(p.text).toBe('');
    }
    expect(pages.map((p) => p.rotation)).toEqual([0, 0, 90, ...Array<number>(16).fill(0)]);
    expect(pages.slice(3).map(printedNumber)).toEqual(range(21, 36));
  });
});
