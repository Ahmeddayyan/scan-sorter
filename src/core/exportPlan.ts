import type { ExportPlan, InferenceResult, PageRecord, SourceFile, UserOverrides } from './types';

/**
 * `<original>-sorted.pdf`, where `<original>` is the base name of the first input file
 * (by input order). Falls back to "scans-sorted.pdf".
 */
export function suggestExportFileName(sources: readonly SourceFile[]): string {
  const first = [...sources].sort((a, b) => a.inputIndex - b.inputIndex)[0];
  const base = (first?.name ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return `${base.length > 0 ? base : 'scans'}-sorted.pdf`;
}

/**
 * Build the ordered page list for export from the current inference result and user edits.
 * Removed pages are already excluded from `result.order`; rotations come from overrides.
 */
export function buildExportPlan(
  pages: readonly PageRecord[],
  result: InferenceResult,
  overrides: UserOverrides,
  sources: readonly SourceFile[],
): ExportPlan {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: ExportPlan['pages'] = [];
  for (const id of result.order) {
    const page = byId.get(id);
    if (!page) continue;
    out.push({
      pageId: id,
      sourceFileId: page.sourceFileId,
      sourceIndex: page.sourceIndex,
      kind: page.kind,
      rotation: overrides.rotations[id] ?? 0,
      number: result.assignments[id]?.number ?? null,
    });
  }
  return { pages: out, fileName: suggestExportFileName(sources) };
}
