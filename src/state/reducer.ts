/**
 * App state: a plain-data reducer. All user edits are UserOverrides (never PageRecord
 * mutations) and every override edit is undoable.
 */
import type {
  PageId,
  PageRecord,
  PipelineError,
  PipelineProgress,
  SourceFile,
  SourceFileId,
  UserOverrides,
} from '../core';
import { EMPTY_OVERRIDES } from '../core';
import { applyOverrideEdit, type OverrideEdit } from './overrides';

export const HISTORY_LIMIT = 60;

export const IDLE_PROGRESS: PipelineProgress = {
  phase: 'idle',
  totalPages: null,
  renderedPages: 0,
  analyzedPages: 0,
  ocrPages: 0,
  currentFile: null,
  message: null,
};

export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'confirm'; warnings: string[] }
  | { phase: 'working'; done: number; total: number }
  | { phase: 'error'; message: string };

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  /** Show an "Undo" button that triggers the history undo. */
  undo?: boolean;
}

export interface History {
  past: UserOverrides[];
  future: UserOverrides[];
}

export interface UiState {
  /** Page whose number editor is open. */
  editingPageId: PageId | null;
  /** Page shown in the large preview. */
  lightboxPageId: PageId | null;
  /** Tiles to scroll to / flash. `nonce` changes on every request so repeats re-trigger. */
  highlight: { ids: string[]; nonce: number };
  exportStatus: ExportStatus;
  notices: Notice[];
  announcement: { text: string; nonce: number };
  nextNoticeId: number;
}

export interface AppState {
  sources: Record<SourceFileId, SourceFile>;
  files: Record<SourceFileId, File>;
  pages: Record<PageId, PageRecord>;
  overrides: UserOverrides;
  history: History;
  progress: PipelineProgress;
  running: boolean;
  errors: PipelineError[];
  demo: boolean;
  ui: UiState;
}

export function createInitialState(init?: { sources?: SourceFile[]; pages?: PageRecord[]; demo?: boolean }): AppState {
  const sources: Record<SourceFileId, SourceFile> = {};
  for (const s of init?.sources ?? []) sources[s.id] = s;
  const pages: Record<PageId, PageRecord> = {};
  for (const p of init?.pages ?? []) pages[p.id] = p;
  const total = Object.keys(pages).length;
  return {
    sources,
    files: {},
    pages,
    overrides: EMPTY_OVERRIDES,
    history: { past: [], future: [] },
    progress: init?.demo
      ? { ...IDLE_PROGRESS, phase: 'done', totalPages: total, renderedPages: total, analyzedPages: total }
      : IDLE_PROGRESS,
    running: false,
    errors: [],
    demo: init?.demo ?? false,
    ui: {
      editingPageId: null,
      lightboxPageId: null,
      highlight: { ids: [], nonce: 0 },
      exportStatus: { phase: 'idle' },
      notices: [],
      announcement: { text: '', nonce: 0 },
      nextNoticeId: 1,
    },
  };
}

export interface BatchPayload {
  sources: { source: SourceFile; file: File }[];
  pages: PageRecord[];
  errors: PipelineError[];
  progress: PipelineProgress | null;
}

export type NoticeInput = Omit<Notice, 'id'>;

export type Action =
  | { type: 'pipeline/started'; fileCount: number }
  | { type: 'pipeline/batch'; batch: BatchPayload }
  | { type: 'pipeline/finished'; cancelled: boolean; failure?: string }
  | { type: 'errors/cleared' }
  | { type: 'edit'; edit: OverrideEdit; announce?: string; notice?: { text: string; undo?: boolean } }
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'ui/editing'; pageId: PageId | null }
  | { type: 'ui/lightbox'; pageId: PageId | null }
  | { type: 'ui/highlight'; ids: string[] }
  | { type: 'ui/highlightCleared' }
  | { type: 'export/status'; status: ExportStatus }
  | { type: 'notice/added'; notice: NoticeInput }
  | { type: 'notice/dismissed'; id: number }
  | { type: 'announce'; text: string }
  | { type: 'session/cleared' };

function announce(ui: UiState, text: string): UiState {
  return { ...ui, announcement: { text, nonce: ui.announcement.nonce + 1 } };
}

function addNotice(ui: UiState, notice: NoticeInput): UiState {
  const notices = [...ui.notices, { ...notice, id: ui.nextNoticeId }].slice(-4);
  return { ...ui, notices, nextNoticeId: ui.nextNoticeId + 1 };
}

function pushHistory(history: History, previous: UserOverrides): History {
  const past = [...history.past, previous];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'pipeline/started':
      return {
        ...state,
        running: true,
        progress: { ...IDLE_PROGRESS, phase: 'loading', message: 'Opening your files…' },
        ui: announce(state.ui, `Reading ${action.fileCount === 1 ? '1 file' : `${action.fileCount} files`}`),
      };

    case 'pipeline/batch': {
      const { batch } = action;
      let sources = state.sources;
      let files = state.files;
      if (batch.sources.length > 0) {
        sources = { ...sources };
        files = { ...files };
        for (const { source, file } of batch.sources) {
          sources[source.id] = source;
          files[source.id] = file;
        }
      }
      let pages = state.pages;
      if (batch.pages.length > 0) {
        pages = { ...pages };
        for (const page of batch.pages) pages[page.id] = page;
      }
      return {
        ...state,
        sources,
        files,
        pages,
        errors: batch.errors.length > 0 ? [...state.errors, ...batch.errors] : state.errors,
        progress: batch.progress ?? state.progress,
      };
    }

    case 'pipeline/finished': {
      // Pages that never finished (cancel / crash) become "not read" so no spinner lingers.
      let pages = state.pages;
      for (const page of Object.values(state.pages)) {
        if (page.status === 'pending' || page.status === 'analyzing') {
          if (pages === state.pages) pages = { ...state.pages };
          pages[page.id] = { ...page, status: 'error', error: 'Not read (stopped early)' };
        }
      }
      let ui = state.ui;
      if (action.failure) ui = addNotice(ui, { kind: 'error', text: action.failure });
      ui = announce(ui, action.cancelled ? 'Stopped reading pages' : action.failure ? 'Reading failed' : 'Finished reading pages');
      return {
        ...state,
        pages,
        running: false,
        progress: {
          ...state.progress,
          phase: action.failure ? 'error' : action.cancelled ? 'cancelled' : 'done',
          message: null,
          currentFile: null,
        },
        ui,
      };
    }

    case 'errors/cleared':
      return { ...state, errors: [] };

    case 'edit': {
      const next = applyOverrideEdit(state.overrides, action.edit);
      if (next === state.overrides) return state;
      let ui = state.ui;
      if (action.announce) ui = announce(ui, action.announce);
      if (action.notice) ui = addNotice(ui, { kind: 'info', ...action.notice });
      return { ...state, overrides: next, history: pushHistory(state.history, state.overrides), ui };
    }

    case 'history/undo': {
      const previous = state.history.past[state.history.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        overrides: previous,
        history: { past: state.history.past.slice(0, -1), future: [state.overrides, ...state.history.future] },
        ui: announce({ ...state.ui, notices: state.ui.notices.filter((n) => !n.undo) }, 'Undid the last change'),
      };
    }

    case 'history/redo': {
      const [next, ...rest] = state.history.future;
      if (!next) return state;
      return {
        ...state,
        overrides: next,
        history: { past: [...state.history.past, state.overrides], future: rest },
        ui: announce(state.ui, 'Redid the change'),
      };
    }

    case 'ui/editing':
      return { ...state, ui: { ...state.ui, editingPageId: action.pageId } };
    case 'ui/lightbox':
      return { ...state, ui: { ...state.ui, lightboxPageId: action.pageId } };
    case 'ui/highlight':
      return { ...state, ui: { ...state.ui, highlight: { ids: action.ids, nonce: state.ui.highlight.nonce + 1 } } };
    case 'ui/highlightCleared':
      return state.ui.highlight.ids.length === 0
        ? state
        : { ...state, ui: { ...state.ui, highlight: { ids: [], nonce: state.ui.highlight.nonce } } };
    case 'export/status':
      return { ...state, ui: { ...state.ui, exportStatus: action.status } };
    case 'notice/added':
      return { ...state, ui: addNotice(state.ui, action.notice) };
    case 'notice/dismissed':
      return { ...state, ui: { ...state.ui, notices: state.ui.notices.filter((n) => n.id !== action.id) } };
    case 'announce':
      return { ...state, ui: announce(state.ui, action.text) };
    case 'session/cleared':
      return createInitialState();
  }
}

/** Next numbering to hand the pipeline when more files are added to a session. */
export function nextIndices(state: Pick<AppState, 'sources' | 'pages'>): { input: number; source: number } {
  let input = 0;
  for (const p of Object.values(state.pages)) input = Math.max(input, p.inputIndex + 1);
  let source = 0;
  for (const s of Object.values(state.sources)) {
    source = Math.max(source, s.inputIndex + 1);
  }
  return { input, source };
}
