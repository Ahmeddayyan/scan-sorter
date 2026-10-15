/** Pure derivations from core results / pipeline progress to display data. */
import type {
  DocumentReport,
  DuplicateKind,
  PageAssignment,
  PageRecord,
  PipelineProgress,
} from '../core';
import { badgeText, formatRange, plural } from './format';

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'manual' | 'pending';
export type BadgeIcon = 'none' | 'alert' | 'copy' | 'pencil' | 'help' | 'spinner';

export interface BadgeInfo {
  tone: BadgeTone;
  icon: BadgeIcon;
  text: string;
  /** Tooltip / screen reader explanation. */
  description: string;
}

export function badgeInfo(
  page: PageRecord,
  assignment: PageAssignment | undefined,
  issue: DuplicateKind | null,
): BadgeInfo {
  if (page.status === 'pending' || page.status === 'analyzing') {
    return { tone: 'pending', icon: 'spinner', text: '…', description: 'Reading the page number…' };
  }
  if (page.status === 'error') {
    return {
      tone: 'danger',
      icon: 'alert',
      text: '?',
      description: page.error ? `Could not read this page: ${page.error}` : 'Could not read this page.',
    };
  }
  if (!assignment) return { tone: 'neutral', icon: 'help', text: '?', description: 'No page number.' };

  const text = badgeText(assignment.number);
  const reason = assignment.reason;
  if (assignment.source === 'manual') {
    return assignment.number
      ? { tone: 'manual', icon: 'pencil', text, description: `Set by you. ${reason}`.trim() }
      : { tone: 'neutral', icon: 'pencil', text, description: 'You marked this page as having no number.' };
  }
  if (assignment.number === null) {
    return { tone: 'neutral', icon: 'help', text, description: reason || 'No page number was found.' };
  }
  if (issue === 'conflict') {
    return {
      tone: 'danger',
      icon: 'alert',
      text,
      description: `Another, different page also reads as ${text}. ${reason}`.trim(),
    };
  }
  if (issue === 'duplicate-scan') {
    return { tone: 'warn', icon: 'copy', text, description: `Looks scanned twice. ${reason}`.trim() };
  }
  if (assignment.flags.includes('out-of-range')) {
    return { tone: 'danger', icon: 'alert', text, description: `Outside the expected range. ${reason}`.trim() };
  }
  if (assignment.flags.includes('low-confidence') || assignment.flags.includes('misread-corrected')) {
    const fixed = assignment.flags.includes('misread-corrected') ? 'Corrected a likely misread. ' : '';
    return { tone: 'warn', icon: 'alert', text, description: `${fixed}Please confirm. ${reason}`.trim() };
  }
  return { tone: 'ok', icon: 'none', text, description: reason };
}

// ---------------------------------------------------------------------------
// Report headline and export warnings
// ---------------------------------------------------------------------------

export interface Headline {
  tone: 'ok' | 'attention' | 'neutral';
  text: string;
  detail: string | null;
  /** The clauses of `text` ("1 page missing", "2 unnumbered"); empty unless tone is 'attention'. */
  parts: string[];
}

export function headline(report: DocumentReport, processing: boolean): Headline {
  const s = report.summary;
  if (processing) {
    return { tone: 'neutral', text: 'Reading your pages…', detail: 'Results update as pages are read.', parts: [] };
  }
  if (s.pages === 0) return { tone: 'neutral', text: 'No pages to show', detail: null, parts: [] };
  const conflicts = report.duplicates.filter((d) => d.kind === 'conflict').length;
  const scans = report.duplicates.filter((d) => d.kind === 'duplicate-scan').length;
  const parts: string[] = [];
  if (s.missing > 0) parts.push(`${plural(s.missing, 'page')} missing`);
  if (scans > 0) parts.push(`${plural(scans, 'duplicate')}`);
  if (conflicts > 0) parts.push(`${plural(conflicts, 'conflict')}`);
  if (s.unnumbered > 0) parts.push(`${s.unnumbered} unnumbered`);
  if (s.lowConfidence > 0) parts.push(`${s.lowConfidence} to confirm`);
  if (parts.length === 0) {
    return { tone: 'ok', text: `All ${plural(s.pages, 'page')} in order`, detail: null, parts: [] };
  }
  return { tone: 'attention', text: parts.join(' · '), detail: `${plural(s.pages, 'page')} in total`, parts };
}

/** Light "are you sure" reasons shown before download. Empty = go straight ahead. */
export function exportWarnings(report: DocumentReport): string[] {
  const out: string[] = [];
  const missing = report.summary.missing;
  if (missing > 0) {
    out.push(missing === 1 ? '1 page is missing' : `${missing} pages are missing`);
  }
  const conflicts = report.duplicates.filter((d) => d.kind === 'conflict').length;
  if (conflicts > 0) {
    out.push(
      conflicts === 1
        ? '1 page number is claimed by two different pages'
        : `${conflicts} page numbers are claimed by different pages`,
    );
  }
  return out;
}

/** Union of pages that are safe to delete across all duplicate-scan issues. */
export function allSafeToRemove(report: DocumentReport): string[] {
  const ids = new Set<string>();
  for (const issue of report.duplicates) for (const id of issue.safeToRemove) ids.add(id);
  return [...ids];
}

/** Map pageId -> issue kind (conflict wins over duplicate-scan). */
export function issueByPage(report: DocumentReport): Map<string, DuplicateKind> {
  const map = new Map<string, DuplicateKind>();
  for (const issue of report.duplicates) {
    for (const id of issue.pageIds) {
      if (issue.kind === 'conflict' || !map.has(id)) map.set(id, issue.kind);
    }
  }
  return map;
}

export function missingSentence(range: { style: 'arabic' | 'roman'; from: number; to: number }): string {
  const text = formatRange(range);
  return range.from === range.to ? `${text} is missing` : `${text} are missing`;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressView {
  title: string;
  detail: string;
  /** 0..1 or null when indeterminate. */
  fraction: number | null;
  counts: string | null;
}

export function describeProgress(p: PipelineProgress, queuedFiles = 0): ProgressView {
  const total = p.totalPages;
  const fraction = total && total > 0 ? Math.min(1, p.analyzedPages / total) : null;
  const counts = total !== null ? `${p.analyzedPages} of ${plural(total, 'page')} read` : null;
  let title: string;
  if (p.phase === 'loading' || (p.phase === 'idle' && total === null)) {
    title = 'Opening your files…';
  } else if (p.phase === 'analyzing') {
    title = 'Reading page numbers…';
  } else if (p.phase === 'cancelled') {
    title = 'Stopped';
  } else if (p.phase === 'error') {
    title = 'Something went wrong';
  } else {
    title = 'Finished reading';
  }
  const bits: string[] = [];
  if (p.message) bits.push(p.message);
  else if (p.currentFile) bits.push(p.currentFile);
  if (p.ocrPages > 0) bits.push(`${plural(p.ocrPages, 'scanned page')} read by OCR`);
  if (queuedFiles > 0) bits.push(`${plural(queuedFiles, 'more file')} waiting`);
  return { title, detail: bits.join(' · '), fraction, counts };
}
