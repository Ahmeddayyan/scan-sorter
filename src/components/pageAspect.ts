import type { PageRecord } from '../core';

/** Natural width / height of a page image (thumbnail first, then the page size). */
export function pageAspect(page: PageRecord): number {
  const t = page.thumbnail;
  if (t && t.width > 0 && t.height > 0) return t.width / t.height;
  if (page.width > 0 && page.height > 0) return page.width / page.height;
  return 0.77;
}
