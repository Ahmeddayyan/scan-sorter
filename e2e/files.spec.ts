/** Real files through the real pipeline (pdf.js worker, tesseract.js OCR) in the browser. */
import {
  addFiles,
  addFilesAndWait,
  cards,
  expect,
  gapTexts,
  hasScanFixtures,
  headline,
  numbersInOrder,
  openApp,
  range,
  test,
  waitForRun,
} from './support';

test.describe('text-layer PDFs', () => {
  test('shuffled-missing7-dup4: sorted, page 7 missing, page 4 scanned twice @dev', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['shuffled-missing7-dup4.pdf']);
    expect(await numbersInOrder(page)).toEqual(['1', '2', '3', '4', '4', '5', '6', '8', '9', '10', '11', '12']);
    expect(await gapTexts(page)).toEqual(['Page 7 missing']);
    await expect(headline(page)).toHaveText('1 page missing · 1 duplicate');
    await expect(page.getByRole('button', { name: 'Page 4 was scanned twice' })).toBeVisible();
    await expect(page.locator('.problems')).toBeHidden();
    // thumbnails are real renders (object URLs), portrait Letter pages
    const img = cards(page).first().locator('img');
    await expect(img).toHaveAttribute('src', /^blob:/);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth < el.naturalHeight)).toBe(true);
  });

  test('page-of-10-trailing-missing: "Page N of 10", pages 9-10 missing', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['page-of-10-trailing-missing.pdf']);
    expect(await numbersInOrder(page)).toEqual(range(1, 8));
    expect(await gapTexts(page)).toEqual(['Pages 9–10 missing']);
    await expect(headline(page)).toHaveText('2 pages missing');
    await expect(page.locator('.summary__notes')).toContainText(/of 10|total/i);
  });

  test('front-matter-roman: roman before arabic, one unnumbered page', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['front-matter-roman.pdf']);
    const numbers = await numbersInOrder(page);
    expect(numbers.filter((n) => n !== '?')).toEqual(['i', 'ii', 'iii', 'iv', '1', '2', '3', '4', '5', '6']);
    expect(numbers.filter((n) => n === '?')).toHaveLength(1);
    expect(await gapTexts(page)).toEqual([]);
    await expect(headline(page)).toContainText('1 unnumbered');
    await expect(headline(page)).not.toContainText('missing');
  });

  test('book-alternating-21-36: all in order', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['book-alternating-21-36.pdf']);
    expect(await numbersInOrder(page)).toEqual(range(21, 36));
    expect(await gapTexts(page)).toEqual([]);
    await expect(headline(page)).toHaveText('All 16 pages in order');
  });

  test('excerpt-dashed-37-45: dashed header numbers, no leading gap', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['excerpt-dashed-37-45.pdf']);
    expect(await numbersInOrder(page)).toEqual(range(37, 45));
    expect(await gapTexts(page)).toEqual([]);
    await expect(headline(page)).toHaveText('All 9 pages in order');
    await expect(page.locator('.summary__notes')).toContainText(/starts at 37|above 1|excerpt/i);
  });

  test('unnumbered.pdf: text layer without numbers goes through OCR and stays unnumbered', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['unnumbered.pdf']);
    expect(await numbersInOrder(page)).toEqual(['?', '?', '?', '?']);
    await expect(headline(page)).toHaveText('4 unnumbered');
    await expect(page.locator('.problems')).toBeHidden();
  });

  test('50-page text-layer PDF (timing)', async ({ page }) => {
    await openApp(page);
    const started = Date.now();
    await addFilesAndWait(page, ['long-1-50.pdf']);
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'timing', description: `long-1-50.pdf (text layer): ${ms} ms` });
    console.log(`[timing] long-1-50.pdf text layer: ${ms} ms`);
    expect(await numbersInOrder(page)).toEqual(range(1, 50));
    await expect(headline(page)).toHaveText('All 50 pages in order');
  });
});

test.describe('OCR (tesseract.js in the browser)', () => {
  test.skip(!hasScanFixtures(), 'scan fixtures need @napi-rs/canvas (npm run fixtures)');

  test('image-only PDF is read by OCR and sorted @dev', async ({ page, guard }) => {
    await openApp(page);
    const started = Date.now();
    await addFilesAndWait(page, ['scan-only-1-10.pdf']);
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'timing', description: `scan-only-1-10.pdf (OCR, 10 pages): ${ms} ms` });
    console.log(`[timing] scan-only-1-10.pdf OCR 10 pages: ${ms} ms`);
    expect(await numbersInOrder(page)).toEqual(range(1, 10));
    await expect(headline(page)).toHaveText('All 10 pages in order');
    await expect(page.locator('.problems')).toBeHidden();
    // The OCR worker fetched its core + language data from our own origin (and nowhere else).
    expect(guard.requests.some((u) => /\/tesseract\/lang\/eng\.traineddata\.gz/.test(u))).toBe(true);
    expect(guard.requests.some((u) => /\/tesseract\/core\/tesseract-core-.*\.wasm\.js/.test(u))).toBe(true);
    expect(guard.requests.some((u) => /\/tesseract\/worker\.min\.js/.test(u))).toBe(true);
  });

  test('PNG, EXIF-rotated JPEG and WebP photos come out sorted and upright', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['photo-p3.webp', 'photo-p2-exif6.jpg', 'photo-p1.png']);
    expect(await numbersInOrder(page)).toEqual(['1', '2', '3']);
    await expect(headline(page)).toHaveText('All 3 pages in order');
    // The sideways JPEG with EXIF orientation 6 is shown upright (portrait thumbnail).
    const jpegCard = cards(page).filter({ hasText: 'photo-p2-exif6.jpg' });
    const img = jpegCard.locator('img');
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth < el.naturalHeight)).toBe(true);
  });

  test('mixed drop: text-layer PDF plus photos, in one order', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['book-alternating-21-36.pdf', 'photo-p1.png', 'photo-p2-exif6.jpg', 'photo-p3.webp']);
    expect(await numbersInOrder(page)).toEqual(['1', '2', '3', ...range(21, 36)]);
    expect(await gapTexts(page)).toEqual(['Pages 4–20 missing']);
    await expect(headline(page)).toHaveText('17 pages missing');
  });
});

test.describe('session handling', () => {
  test('unsupported file is rejected with a message, nothing else changes', async ({ page }) => {
    await openApp(page);
    await addFiles(page, ['notes.txt']);
    await expect(page.locator('.toast--error')).toContainText('notes.txt: Only PDF, JPG, PNG and WebP files can be used.');
    await expect(page.locator('.empty')).toBeVisible();
    await expect(page.locator('.review')).toBeHidden();
  });

  test('add files after a run merges into the same document', async ({ page }) => {
    await openApp(page);
    await addFilesAndWait(page, ['book-alternating-21-36.pdf']);
    await expect(headline(page)).toHaveText('All 16 pages in order');
    await addFilesAndWait(page, ['excerpt-dashed-37-45.pdf']);
    expect(await numbersInOrder(page)).toEqual(range(21, 45));
    // The second file prints its numbers somewhere else (top centre vs. bottom corners), so core
    // asks to confirm those reads - but nothing is missing or duplicated.
    await expect(headline(page)).not.toContainText(/missing|duplicate|conflict/);
    await expect(page.locator('.summary__notes')).toContainText('21');
  });

  test('adding real files to the demo replaces the demo session', async ({ page }) => {
    await openApp(page, '?demo');
    await expect(page.locator('.app-header__demo')).toBeVisible();
    await addFilesAndWait(page, ['excerpt-dashed-37-45.pdf']);
    await expect(page.locator('.app-header__demo')).toBeHidden();
    expect(new URL(page.url()).searchParams.has('demo')).toBe(false);
    expect(await numbersInOrder(page)).toEqual(range(37, 45));
  });

  test('cancel mid-run on a 240-page PDF stops promptly and the app stays usable', async ({ page }) => {
    await openApp(page);
    await addFiles(page, ['big-shuffled-240.pdf']);
    await expect(page.locator('.processing')).toBeVisible();
    await expect(cards(page).nth(24)).toBeVisible({ timeout: 90_000 });
    const started = Date.now();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.processing--stopped')).toBeVisible({ timeout: 15_000 });
    const ms = Date.now() - started;
    console.log(`[timing] cancel latency: ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
    const count = await cards(page).count();
    expect(count).toBeGreaterThanOrEqual(25);
    expect(count).toBeLessThan(240);
    await expect(page.locator('.processing--stopped')).toContainText('Stopped.');
    await expect(page.getByRole('button', { name: 'Download sorted PDF' })).toBeEnabled();

    // Still usable: edit a number, then add another file and it is read.
    await cards(page).first().locator('.page-card__badge').click();
    await page.getByRole('dialog').getByLabel('What number is printed on this page?').fill('1');
    await page.keyboard.press('Enter');
    await expect(cards(page).first().locator('.page-card__badge')).toHaveClass(/badge--manual/);
    await addFiles(page, ['excerpt-dashed-37-45.pdf']);
    await waitForRun(page);
    await expect(cards(page)).toHaveCount(count + 9);
  });

  test('files dropped during a run are queued and read afterwards', async ({ page }) => {
    await openApp(page);
    await addFiles(page, ['long-1-50.pdf']);
    await expect(page.locator('.processing')).toBeVisible();
    await addFiles(page, ['appendix-51-60.pdf']);
    await expect(page.locator('.toast')).toContainText('1 file will be read next');
    await expect(cards(page)).toHaveCount(60, { timeout: 60_000 });
    await waitForRun(page);
    expect(await numbersInOrder(page)).toEqual(range(1, 60));
    await expect(headline(page)).toHaveText('All 60 pages in order');
  });
});
