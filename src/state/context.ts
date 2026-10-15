import { createContext, useContext } from 'react';
import type { InferenceResult, PageId, PageNumber, PageRecord } from '../core';
import type { AppState } from './reducer';

export interface AppView {
  state: AppState;
  pageList: PageRecord[];
  result: InferenceResult;
  canUndo: boolean;
  canRedo: boolean;
  /** Files waiting for the current run to finish. */
  queuedFiles: number;
}

export interface AppActions {
  addFiles: (files: readonly File[]) => void;
  cancel: () => void;
  startOver: () => void;
  requestExport: () => void;
  confirmExport: () => void;
  dismissExport: () => void;
  cancelExport: () => void;
  setNumber: (pageId: PageId, number: PageNumber | null) => void;
  resetNumber: (pageId: PageId) => void;
  rotate: (pageId: PageId) => void;
  removePages: (pageIds: readonly PageId[], what?: string) => void;
  removeDuplicateScans: () => void;
  setManualOrder: (order: readonly PageId[], announcement?: string) => void;
  restoreAutoOrder: () => void;
  undo: () => void;
  redo: () => void;
  openEditor: (pageId: PageId | null) => void;
  openLightbox: (pageId: PageId | null) => void;
  highlight: (ids: string[]) => void;
  dismissNotice: (id: number) => void;
  notify: (kind: 'info' | 'success' | 'error', text: string) => void;
  clearErrors: () => void;
}

export const ViewContext = createContext<AppView | null>(null);
export const ActionsContext = createContext<AppActions | null>(null);

export function useApp(): AppView {
  const value = useContext(ViewContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export function useActions(): AppActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useActions must be used inside <AppProvider>');
  return value;
}
