/** The `?demo` session: every review interaction without the pipeline. */
import { cards, expect, gapTexts, gaps, headline, numbersInOrder, openApp, pressKeys, test } from './support';

test.describe('demo review screen', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, '?demo');
    await expect(page.locator('.review')).toBeVisible();
  });

  test('headline, gap tile and order @dev', async ({ page }) => {
    await expect(headline(page)).toHaveText(/1 page missing · 1 duplicate · 1 conflict · 2 unnumbered · \d+ to confirm/);
    await expect(page.locator('.app-header__demo')).toHaveText('Demo data');
    expect(await gapTexts(page)).toEqual(['Page 14 missing']);
    const numbers = await numbersInOrder(page);
    // roman front matter first, then the arabic body (unnumbered pages stay next to their input neighbour)
    expect(numbers.filter((n) => n !== '?').slice(0, 4)).toEqual(['i', 'ii', 'iii', '1']);
    expect(numbers.filter((n) => n === '?')).toHaveLength(2);
    expect(numbers.indexOf('13')).toBeLessThan(numbers.indexOf('15'));
    // the gap tile sits between 13 and 15
    const tileTexts = await page.locator('.page-grid__list > li').allInnerTexts();
    const gapIndex = tileTexts.findIndex((t) => t.includes('Page 14 missing'));
    expect(tileTexts[gapIndex - 1]).toContain('p. 13');
    expect(tileTexts[gapIndex + 1]).toContain('p. 15');
    await expect(page.getByRole('button', { name: 'Download sorted PDF' })).toBeEnabled();
  });

  test('sidebar items scroll to and highlight tiles', async ({ page }) => {
    await page.getByRole('button', { name: 'Page 14 is missing' }).click();
    await expect(gaps(page).first()).toHaveClass(/is-highlighted/);
    await expect(gaps(page).first()).toBeInViewport();

    await page.getByRole('button', { name: 'Page 9 was scanned twice' }).click();
    const highlighted = page.locator('.page-card.is-highlighted');
    await expect(highlighted).toHaveCount(2);
    await expect(highlighted.first()).toBeInViewport();
    for (const text of await highlighted.locator('.page-card__badge .num').allInnerTexts()) expect(text).toBe('p. 9');
    await expect(highlighted).toHaveCount(0, { timeout: 6000 }); // the flash clears itself
  });

  test('remove duplicate scans, then undo from the toast and the toolbar', async ({ page }) => {
    const before = await cards(page).count();
    await page.getByRole('button', { name: 'Remove duplicate scans' }).click();
    await expect(cards(page)).toHaveCount(before - 1);
    await expect(page.locator('.toast')).toContainText('Removed 1 duplicate scan');
    await expect(headline(page)).not.toContainText('duplicate');
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(cards(page)).toHaveCount(before);
    await expect(headline(page)).toContainText('1 duplicate');

    await page.getByRole('button', { name: 'Remove duplicate scans' }).click();
    await expect(cards(page)).toHaveCount(before - 1);
    const toolbar = page.locator('.toolbar');
    await toolbar.getByRole('button', { name: 'Undo' }).click();
    await expect(cards(page)).toHaveCount(before);
    await toolbar.getByRole('button', { name: 'Redo' }).click();
    await expect(cards(page)).toHaveCount(before - 1);
  });

  test('number editor: invalid input, set, reset, no-number', async ({ page }) => {
    // Pin the card by id: a "badge text" filter would move to another card once the number changes.
    const unnumberedId = await cards(page)
      .filter({ has: page.locator('.page-card__badge .num', { hasText: /^\?$/ }) })
      .first()
      .getAttribute('id');
    const unnumbered = page.locator(`#${unnumberedId}`);
    await unnumbered.locator('.page-card__badge').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Page number' })).toBeVisible();
    const input = dialog.getByLabel('What number is printed on this page?');
    await expect(input).toBeFocused();

    await input.fill('abc');
    await dialog.getByRole('button', { name: 'Save number' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Use a number like 17');
    await expect(dialog).toBeVisible();

    await input.fill('14');
    await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(unnumbered.locator('.page-card__badge')).toHaveText('p. 14');
    await expect(unnumbered.locator('.page-card__badge')).toHaveClass(/badge--manual/);
    await expect(gaps(page)).toHaveCount(0);
    await expect(headline(page)).not.toContainText('missing');

    // Reset to automatic brings the gap back.
    await unnumbered.locator('.page-card__badge').click();
    await dialog.getByRole('button', { name: 'Reset to automatic' }).click();
    await expect(dialog).toBeHidden();
    await expect(unnumbered.locator('.page-card__badge')).toHaveText('?');
    expect(await gapTexts(page)).toEqual(['Page 14 missing']);

    // Force "no number" on a numbered page.
    const numberedId = await cards(page)
      .filter({ has: page.locator('.page-card__badge .num', { hasText: /^p\. 3$/ }) })
      .first()
      .getAttribute('id');
    const numbered = page.locator(`#${numberedId}`);
    await numbered.locator('.page-card__badge').click();
    await dialog.getByRole('button', { name: 'This page has no number' }).click();
    await expect(numbered.locator('.page-card__badge')).toHaveText('?');
    expect(await gapTexts(page)).toEqual(['Page 3 missing', 'Page 14 missing']);

    // Esc closes without saving.
    await numbered.locator('.page-card__badge').click();
    await input.fill('99');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(numbered.locator('.page-card__badge')).toHaveText('?');
  });

  test('rotate a page (card and lightbox) and undo', async ({ page }) => {
    const card = cards(page).first();
    await card.getByRole('button', { name: /^Rotate/ }).click();
    await expect(card.locator('.page-image')).toHaveClass(/is-sideways/);
    await card.getByRole('button', { name: /^Rotate/ }).click();
    await expect(card.locator('.page-image')).not.toHaveClass(/is-sideways/);
    await expect(card.locator('.page-image')).toHaveAttribute('style', /--rot:\s*180deg/);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card.locator('.page-image')).toHaveClass(/is-sideways/);
  });

  test('lightbox: open, arrow keys, actions, Esc', async ({ page }) => {
    await cards(page).nth(1).locator('.page-card__open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.lightbox__sub')).toContainText('Position 2 of 32');
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.lightbox__sub')).toContainText('Position 3 of 32');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('.lightbox__sub')).toContainText('Position 1 of 32');
    await expect(dialog.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Rotate' }).click();
    await expect(dialog.locator('.lightbox__image')).toHaveClass(/is-sideways/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cards(page).first().locator('.page-image')).toHaveClass(/is-sideways/);

    // Remove from the lightbox moves to the next page.
    const total = await cards(page).count();
    await cards(page).nth(4).locator('.page-card__open').click();
    await dialog.getByRole('button', { name: 'Remove page' }).click();
    await expect(dialog.locator('.lightbox__sub')).toContainText(`Position 5 of ${total - 1}`);
    await dialog.getByRole('button', { name: 'Edit number' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Page number' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('keyboard drag reorder -> manual order -> back to automatic', async ({ page }) => {
    const first = cards(page).first();
    const firstLabel = await first.locator('.page-card__meta').innerText();
    await first.getByRole('button', { name: /^Move / }).focus();
    await pressKeys(page, ['Space', 'ArrowRight', 'ArrowRight', 'Space']);
    await expect(page.locator('.page-grid__manual')).toContainText('Order set by hand');
    await expect(gaps(page)).toHaveCount(0);
    await expect(cards(page).first().locator('.page-card__meta')).not.toHaveText(firstLabel);
    expect((await page.locator('.page-card__meta').allInnerTexts()).indexOf(firstLabel)).toBe(2);
    await expect(page.locator('.toolbar').getByRole('button', { name: 'Back to automatic order' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Page 14 is missing' })).toBeDisabled();

    await page.locator('.page-grid__manual').getByRole('button', { name: 'Back to automatic order' }).click();
    await expect(page.locator('.page-grid__manual')).toBeHidden();
    await expect(cards(page).first().locator('.page-card__meta')).toHaveText(firstLabel);
    expect(await gapTexts(page)).toEqual(['Page 14 missing']);
  });

  test('confirm a low-confidence read from the sidebar', async ({ page }) => {
    const row = page.locator('.summary__section--warn').filter({ hasText: 'Please confirm' }).locator('.summary__row').first();
    const label = (await row.locator('.summary__item small').innerText()).trim();
    const before = await page.locator('.summary__section').filter({ hasText: 'Please confirm' }).locator('.summary__count').innerText();
    await row.getByRole('button', { name: /^Confirm/ }).click();
    const card = cards(page).filter({ has: page.locator('.page-card__meta', { hasText: label }) }).first();
    await expect(card.locator('.page-card__badge')).toHaveClass(/badge--manual/);
    const section = page.locator('.summary__section').filter({ hasText: 'Please confirm' });
    if (Number(before) > 1) await expect(section.locator('.summary__count')).toHaveText(String(Number(before) - 1));
    else await expect(section).toBeHidden();
  });

  test('download is off in the demo; theme toggle; start over leaves the demo', async ({ page }) => {
    await page.getByRole('button', { name: 'Download sorted PDF' }).click();
    await expect(page.locator('.toast')).toContainText('turned off in the demo');

    const html = page.locator('html');
    await page.getByRole('button', { name: /Colour theme/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /Colour theme/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /Colour theme/ }).click();
    await expect(html).not.toHaveAttribute('data-theme', /./);

    await page.getByRole('button', { name: 'Start over' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Start over?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('.empty')).toBeVisible();
    await expect(page.locator('.app-header__demo')).toBeHidden();
    expect(new URL(page.url()).searchParams.has('demo')).toBe(false);
  });
});
