import { describe, expect, it } from 'vitest';
import { inferDocument } from '../../core';
import type { PageRecord, SourceFile } from '../../core';
import { buildDemoSession } from '../demo';
import { HISTORY_LIMIT, createInitialState, nextIndices, reducer, type Action, type AppState } from '../reducer';

const run = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, state);

const source: SourceFile = {
  id: 's1',
  name: 'a.pdf',
  kind: 'pdf',
  mimeType: 'application/pdf',
  size: 1,
  inputIndex: 0,
  pageCount: 2,
};

const page = (id: string, inputIndex: number, status: PageRecord['status'] = 'done'): PageRecord => ({
  id,
  sourceFileId: 's1',
  sourceIndex: inputIndex,
  inputIndex,
  kind: 'pdf-page',
  label: id,
  width: 100,
  height: 140,
  thumbnail: null,
  perceptualHash: null,
  evidence: { source: 'none', bands: ['full'], items: [], hasTextLayer: false },
  candidates: [],
  status,
});

describe('pipeline actions', () => {
  it('upserts pages by id, stores files and tracks progress', () => {
    const file = new File(['x'], 'a.pdf');
    let s = run(createInitialState(), { type: 'pipeline/started', fileCount: 1 });
    expect(s.running).toBe(true);
    s = run(s, {
      type: 'pipeline/batch',
      batch: { sources: [{ source, file }], pages: [page('p1', 0, 'pending')], errors: [], progress: null },
    });
    s = run(s, {
      type: 'pipeline/batch',
      batch: {
        sources: [],
        pages: [page('p1', 0, 'done'), page('p2', 1, 'pending')],
        errors: [{ sourceFileId: 's1', fileName: 'a.pdf', pageId: 'p2', message: 'bad' }],
        progress: {
          phase: 'analyzing',
          totalPages: 2,
          renderedPages: 2,
          analyzedPages: 1,
          ocrPages: 0,
          currentFile: 'a.pdf',
          message: null,
        },
      },
    });
    expect(Object.keys(s.pages)).toEqual(['p1', 'p2']);
    expect(s.pages.p1!.status).toBe('done');
    expect(s.files.s1).toBe(file);
    expect(s.errors).toHaveLength(1);
    expect(s.progress.phase).toBe('analyzing');
    expect(nextIndices(s)).toEqual({ input: 2, source: 1 });
  });

  it('turns unfinished pages into "not read" when cancelled and never mutates records', () => {
    const pending = page('p2', 1, 'pending');
    let s = run(createInitialState(), {
      type: 'pipeline/batch',
      batch: { sources: [], pages: [page('p1', 0), pending], errors: [], progress: null },
    });
    s = run(s, { type: 'pipeline/finished', cancelled: true });
    expect(s.running).toBe(false);
    expect(s.progress.phase).toBe('cancelled');
    expect(s.pages.p2!.status).toBe('error');
    expect(s.pages.p2!.error).toMatch(/^Not read/);
    expect(pending.status).toBe('pending');
    expect(s.pages.p1!.status).toBe('done');
  });

  it('reports a failure as an error notice', () => {
    const s = run(
      createInitialState(),
      { type: 'pipeline/started', fileCount: 1 },
      { type: 'pipeline/finished', cancelled: false, failure: 'nope' },
    );
    expect(s.progress.phase).toBe('error');
    expect(s.ui.notices[0]).toMatchObject({ kind: 'error', text: 'nope' });
  });
});

describe('edits, undo and redo', () => {
  const setNo = (n: number): Action => ({
    type: 'edit',
    edit: { type: 'number/set', pageId: 'p1', number: { value: n, style: 'arabic' } },
  });

  it('records history, undoes, redoes and clears redo on a new edit', () => {
    let s = run(createInitialState(), setNo(1), setNo(2));
    expect(s.history.past).toHaveLength(2);
    s = run(s, { type: 'history/undo' });
    expect(s.overrides.numbers.p1).toEqual({ value: 1, style: 'arabic' });
    expect(s.history.future).toHaveLength(1);
    s = run(s, { type: 'history/redo' });
    expect(s.overrides.numbers.p1).toEqual({ value: 2, style: 'arabic' });
    s = run(s, { type: 'history/undo' }, setNo(9));
    expect(s.history.future).toHaveLength(0);
    s = run(s, { type: 'history/undo' }, { type: 'history/undo' }, { type: 'history/undo' });
    expect(s.overrides.numbers).toEqual({});
    expect(s.history.past).toHaveLength(0);
  });

  it('does not add history for no-op edits and caps its size', () => {
    let s = run(createInitialState(), setNo(1), setNo(1));
    expect(s.history.past).toHaveLength(1);
    for (let i = 2; i < HISTORY_LIMIT + 20; i += 1) s = run(s, setNo(i));
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
  });

  it('removal adds an undo notice that disappears after undo', () => {
    let s = run(createInitialState(), {
      type: 'edit',
      edit: { type: 'pages/remove', pageIds: ['p1'] },
      notice: { text: 'Removed', undo: true },
    });
    expect(s.ui.notices).toHaveLength(1);
    s = run(s, { type: 'history/undo' });
    expect(s.overrides.removed).toEqual([]);
    expect(s.ui.notices).toHaveLength(0);
  });

  it('keeps PageRecords untouched while overrides change the inferred result', () => {
    const demo = buildDemoSession();
    let s = createInitialState({ sources: demo.sources, pages: demo.pages, demo: true });
    const before = s.pages;
    const victim = demo.pages[0]!.id;
    s = run(
      s,
      { type: 'edit', edit: { type: 'pages/remove', pageIds: [victim] } },
      { type: 'edit', edit: { type: 'page/rotate', pageId: victim, quarterTurns: 1 } },
    );
    expect(s.pages).toBe(before);
    const result = inferDocument(Object.values(s.pages), { overrides: s.overrides });
    expect(result.order).not.toContain(victim);
    expect(result.report.summary.removed).toBe(1);
  });
});

describe('ui actions', () => {
  it('highlight gets a fresh nonce each time and can be cleared', () => {
    let s = run(createInitialState(), { type: 'ui/highlight', ids: ['a'] }, { type: 'ui/highlight', ids: ['a'] });
    expect(s.ui.highlight.nonce).toBe(2);
    s = run(s, { type: 'ui/highlightCleared' });
    expect(s.ui.highlight.ids).toEqual([]);
  });

  it('notices get unique ids and dismiss works', () => {
    let s = run(
      createInitialState(),
      { type: 'notice/added', notice: { kind: 'info', text: 'a' } },
      { type: 'notice/added', notice: { kind: 'info', text: 'b' } },
    );
    const [first, second] = s.ui.notices;
    expect(first!.id).not.toBe(second!.id);
    s = run(s, { type: 'notice/dismissed', id: first!.id });
    expect(s.ui.notices.map((n) => n.text)).toEqual(['b']);
  });

  it('session/cleared resets everything', () => {
    const demo = buildDemoSession();
    const s = run(createInitialState({ sources: demo.sources, pages: demo.pages, demo: true }), {
      type: 'session/cleared',
    });
    expect(s.pages).toEqual({});
    expect(s.demo).toBe(false);
    expect(s.history.past).toEqual([]);
  });
});
