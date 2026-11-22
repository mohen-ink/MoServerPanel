import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'msp-theme';

function readStoredMode(): ThemeMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

function getSystemDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemDark() ? 'dark' : 'light';
  return mode;
}

function applyThemeClass(resolved: 'light' | 'dark') {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }
}

export function useTheme(): {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolved: 'light' | 'dark';
} {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(readStoredMode()));

  const applyMode = useCallback((nextMode: ThemeMode) => {
    const nextResolved = resolveTheme(nextMode);
    setResolved(nextResolved);
    applyThemeClass(nextResolved);
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }
      setModeState(next);
      applyMode(next);
    },
    [applyMode]
  );

  useEffect(() => {
    applyMode(mode);
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyMode('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, applyMode]);

  return { mode, setMode, resolved };
}
