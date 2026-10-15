/**
 * React glue: reducer + context, the pipeline runner (throttled batching, cancel, queue,
 * start over) and export. Pure logic lives in reducer.ts / overrides.ts / derive.ts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PageId, PageNumber, PageRecord, PipelineError, PipelineProgress, SourceFile } from '../core';
import { buildExportPlan, formatPageNumber, inferDocument } from '../core';
import { downloadExport, exportSortedPdf } from '../export';
import { processFiles, releasePages, shutdownPipeline } from '../pipeline';
import { buildDemoSession, isDemoRequested } from './demo';
import { allSafeToRemove, exportWarnings } from './derive';
import { classifyFiles, rejectionMessage } from './files';
import { ActionsContext, ViewContext, type AppActions, type AppView } from './context';
import { friendlyError, plural } from './format';
import { createInitialState, reducer, type AppState, type BatchPayload } from './reducer';

const FLUSH_INTERVAL_MS = 120;
const HIGHLIGHT_MS = 2600;

function initialState(): AppState {
  if (typeof window !== 'undefined' && isDemoRequested(window.location.search)) {
    const demo = buildDemoSession();
    return createInitialState({ sources: demo.sources, pages: demo.pages, demo: true });
  }
  return createInitialState();
}

interface Buffer {
  sources: { source: SourceFile; file: File }[];
  pages: Map<PageId, PageRecord>;
  errors: PipelineError[];
  progress: PipelineProgress | null;
}

const emptyBuffer = (): Buffer => ({ sources: [], pages: new Map(), errors: [], progress: null });

function leaveDemoUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('demo')) {
      url.searchParams.delete('demo');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch {
    /* not critical */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [queued, setQueued] = useState(0);

  const pageList = useMemo(() => Object.values(state.pages), [state.pages]);
  const result = useMemo(
    () => inferDocument(pageList, { overrides: state.overrides }),
    [pageList, state.overrides],
  );

  // Latest values for stable callbacks.
  const latest = useRef({ state, pageList, result });
  useEffect(() => {
    latest.current = { state, pageList, result };
  });

  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const queue = useRef<File[]>([]);
  const indices = useRef({ input: 0, source: 0 });
  const buffer = useRef<Buffer>(emptyBuffer());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const b = buffer.current;
    if (b.sources.length === 0 && b.pages.size === 0 && b.errors.length === 0 && b.progress === null) return;
    buffer.current = emptyBuffer();
    const batch: BatchPayload = { sources: b.sources, pages: [...b.pages.values()], errors: b.errors, progress: b.progress };
    dispatch({ type: 'pipeline/batch', batch });
  }, []);

  const schedule = useCallback(() => {
    if (timer.current === null) timer.current = setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const run = useCallback(
    async function runBatch(files: File[]) {
      const gen = generation.current;
      const ctl = new AbortController();
      controller.current = ctl;
      dispatch({ type: 'pipeline/started', fileCount: files.length });
      const alive = () => generation.current === gen;
      let failure: string | undefined;
      let cancelled = false;
      try {
        const res = await processFiles(
          files,
          {
            onSource: (source, file) => {
              if (!alive()) return;
              indices.current.source = Math.max(indices.current.source, source.inputIndex + 1);
              buffer.current.sources.push({ source, file });
              schedule();
            },
            onPage: (page) => {
              if (!alive()) return;
              indices.current.input = Math.max(indices.current.input, page.inputIndex + 1);
              buffer.current.pages.set(page.id, page);
              schedule();
            },
            onProgress: (progress) => {
              if (!alive()) return;
              buffer.current.progress = progress;
              schedule();
            },
            onError: (error) => {
              if (!alive()) return;
              buffer.current.errors.push(error);
              schedule();
            },
          },
          { signal: ctl.signal, startInputIndex: indices.current.input, startSourceIndex: indices.current.source },
        );
        cancelled = res.cancelled;
      } catch (err) {
        if (ctl.signal.aborted) cancelled = true;
        else failure = friendlyError(err, "We couldn't read those files.");
      }
      if (!alive()) return;
      flush();
      controller.current = null;
      dispatch({ type: 'pipeline/finished', cancelled, failure });
      const next = queue.current;
      if (next.length > 0 && !cancelled) {
        queue.current = [];
        setQueued(0);
        void runBatch(next);
      }
    },
    [flush, schedule],
  );

  const notify = useCallback((kind: 'info' | 'success' | 'error', text: string) => {
    dispatch({ type: 'notice/added', notice: { kind, text } });
  }, []);

  const addFiles = useCallback(
    (input: readonly File[]) => {
      if (input.length === 0) return;
      const { accepted, rejected } = classifyFiles(input);
      if (rejected.length > 0) notify('error', rejectionMessage(rejected));
      if (accepted.length === 0) return;
      if (latest.current.state.demo) {
        generation.current += 1;
        indices.current = { input: 0, source: 0 };
        dispatch({ type: 'session/cleared' });
        leaveDemoUrl();
      }
      if (controller.current) {
        queue.current = [...queue.current, ...accepted];
        setQueued(queue.current.length);
        notify('info', `${plural(accepted.length, 'file')} will be read next.`);
        return;
      }
      void run(accepted);
    },
    [notify, run],
  );

  const cancel = useCallback(() => {
    queue.current = [];
    setQueued(0);
    controller.current?.abort();
  }, []);

  const startOver = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    exportController.current?.abort();
    queue.current = [];
    setQueued(0);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    buffer.current = emptyBuffer();
    indices.current = { input: 0, source: 0 };
    const { state: s } = latest.current;
    if (!s.demo) {
      try {
        releasePages(Object.keys(s.pages));
        void shutdownPipeline().catch(() => undefined);
      } catch {
        /* pipeline not available: nothing to release */
      }
    }
    dispatch({ type: 'session/cleared' });
    leaveDemoUrl();
  }, []);

  // --- export ---------------------------------------------------------------------------
  const runExport = useCallback(async () => {
    const { state: s, pageList: pages, result: r } = latest.current;
    const ctl = new AbortController();
    exportController.current = ctl;
    const plan = buildExportPlan(pages, r, s.overrides, Object.values(s.sources));
    dispatch({ type: 'export/status', status: { phase: 'working', done: 0, total: plan.pages.length } });
    try {
      if (plan.pages.length === 0) throw new Error('There are no pages to save.');
      const out = await exportSortedPdf({
        plan,
        sources: new Map<string, Blob>(Object.entries(s.files)),
        signal: ctl.signal,
        onProgress: (done, total) => {
          if (!ctl.signal.aborted) dispatch({ type: 'export/status', status: { phase: 'working', done, total } });
        },
      });
      downloadExport(out);
      dispatch({ type: 'export/status', status: { phase: 'idle' } });
      notify('success', `Saved ${out.fileName} (${plural(out.pageCount, 'page')}).`);
    } catch (err) {
      if (ctl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        dispatch({ type: 'export/status', status: { phase: 'idle' } });
      } else {
        dispatch({
          type: 'export/status',
          status: { phase: 'error', message: friendlyError(err, "We couldn't create the PDF.") },
        });
      }
    } finally {
      if (exportController.current === ctl) exportController.current = null;
    }
  }, [notify]);

  const requestExport = useCallback(() => {
    const { state: s, result: r } = latest.current;
    if (s.demo) {
      notify('info', 'Downloading is turned off in the demo. Add your own files to try it for real.');
      return;
    }
    if (s.running) return;
    const warnings = exportWarnings(r.report);
    if (warnings.length > 0) dispatch({ type: 'export/status', status: { phase: 'confirm', warnings } });
    else void runExport();
  }, [notify, runExport]);

  const cancelExport = useCallback(() => {
    exportController.current?.abort();
    dispatch({ type: 'export/status', status: { phase: 'idle' } });
  }, []);

  // --- edits ----------------------------------------------------------------------------
  const setNumber = useCallback((pageId: PageId, number: PageNumber | null) => {
    dispatch({
      type: 'edit',
      edit: { type: 'number/set', pageId, number },
      announce: number ? `Page number set to ${formatPageNumber(number)}` : 'Marked as having no page number',
    });
  }, []);

  const resetNumber = useCallback((pageId: PageId) => {
    dispatch({
      type: 'edit',
      edit: { type: 'number/clear', pageId },
      announce: 'Back to the automatic page number',
    });
  }, []);

  const rotate = useCallback((pageId: PageId) => {
    dispatch({ type: 'edit', edit: { type: 'page/rotate', pageId, quarterTurns: 1 }, announce: 'Page rotated' });
  }, []);

  const removePages = useCallback((pageIds: readonly PageId[], what?: string) => {
    if (pageIds.length === 0) return;
    const text = `${what ?? `Removed ${plural(pageIds.length, 'page')}`}.`;
    dispatch({ type: 'edit', edit: { type: 'pages/remove', pageIds }, announce: text, notice: { text, undo: true } });
  }, []);

  const removeDuplicateScans = useCallback(() => {
    const ids = allSafeToRemove(latest.current.result.report);
    if (ids.length === 0) return;
    removePages(ids, `Removed ${plural(ids.length, 'duplicate scan')}`);
  }, [removePages]);

  const setManualOrder = useCallback((order: readonly PageId[], announcement?: string) => {
    dispatch({ type: 'edit', edit: { type: 'order/manual', order }, announce: announcement ?? 'Page order changed by hand' });
  }, []);

  const restoreAutoOrder = useCallback(() => {
    dispatch({ type: 'edit', edit: { type: 'order/auto' }, announce: 'Back to automatic order' });
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      addFiles,
      cancel,
      startOver,
      requestExport,
      confirmExport: () => void runExport(),
      dismissExport: () => dispatch({ type: 'export/status', status: { phase: 'idle' } }),
      cancelExport,
      setNumber,
      resetNumber,
      rotate,
      removePages,
      removeDuplicateScans,
      setManualOrder,
      restoreAutoOrder,
      undo: () => dispatch({ type: 'history/undo' }),
      redo: () => dispatch({ type: 'history/redo' }),
      openEditor: (pageId) => dispatch({ type: 'ui/editing', pageId }),
      openLightbox: (pageId) => dispatch({ type: 'ui/lightbox', pageId }),
      highlight: (ids) => dispatch({ type: 'ui/highlight', ids }),
      dismissNotice: (id) => dispatch({ type: 'notice/dismissed', id }),
      notify,
      clearErrors: () => dispatch({ type: 'errors/cleared' }),
    }),
    [
      addFiles,
      cancel,
      startOver,
      requestExport,
      runExport,
      cancelExport,
      setNumber,
      resetNumber,
      rotate,
      removePages,
      removeDuplicateScans,
      setManualOrder,
      restoreAutoOrder,
      notify,
    ],
  );

  // Clear the "flash" highlight after a moment.
  const highlightNonce = state.ui.highlight.nonce;
  const highlightActive = state.ui.highlight.ids.length > 0;
  useEffect(() => {
    if (!highlightActive) return undefined;
    const id = setTimeout(() => dispatch({ type: 'ui/highlightCleared' }), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [highlightNonce, highlightActive]);

  // Stop work if the whole app unmounts.
  useEffect(
    () => () => {
      controller.current?.abort();
      exportController.current?.abort();
    },
    [],
  );

  const view = useMemo<AppView>(
    () => ({
      state,
      pageList,
      result,
      canUndo: state.history.past.length > 0,
      canRedo: state.history.future.length > 0,
      queuedFiles: queued,
    }),
    [state, pageList, result, queued],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <ViewContext.Provider value={view}>{children}</ViewContext.Provider>
    </ActionsContext.Provider>
  );
}
