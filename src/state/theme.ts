/** Theme preference: pure helpers + a tiny hook. Storage access is always try/catch-wrapped. */
import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'scan-sorter-theme';

export function parseTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** system -> light -> dark -> system */
export function nextTheme(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
}

function readStored(): ThemePreference {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function writeStored(theme: ThemePreference): void {
  try {
    if (theme === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode, blocked): the choice just won't persist */
  }
}

function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: ThemePreference; cycle: () => void } {
  const [theme, setTheme] = useState<ThemePreference>(readStored);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const cycle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      writeStored(next);
      return next;
    });
  }, []);
  return { theme, cycle };
}
