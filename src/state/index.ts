/**
 * Application state barrel.
 *   reducer.ts    pure reducer + AppState (tested)
 *   overrides.ts  pure UserOverrides edits (tested)
 *   derive.ts     badges / headline / progress text (tested)
 *   store.tsx     <AppProvider>, useApp(), useActions()
 *   demo.ts       `?demo` session generator
 */
export { AppProvider } from './store';
export { useActions, useApp, type AppActions, type AppView } from './context';
export { nextTheme, useTheme, type ThemePreference } from './theme';
export { useMediaQuery } from './useMediaQuery';
export * from './derive';
export * from './format';
export { ACCEPT_ATTR, classifyFiles } from './files';
export { moveInOrder } from './overrides';
export type { AppState, ExportStatus, Notice } from './reducer';
