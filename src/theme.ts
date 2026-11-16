/** Theme handling: system-following by default, with manual light/dark overrides. */

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "notes.theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let current: ThemeMode = "system";

export function getThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Ignore unavailable storage.
  }
  return "system";
}

export function resolvedTheme(mode: ThemeMode = current): "light" | "dark" {
  if (mode === "system") return darkQuery.matches ? "dark" : "light";
  return mode;
}

function paint(mode: ThemeMode): void {
  const theme = resolvedTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** Applies a theme mode, persists it and notifies the caller. */
export function applyTheme(mode: ThemeMode, onChange?: (mode: ThemeMode) => void): void {
  current = mode;
  paint(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore unavailable storage.
  }
  onChange?.(mode);
}

/** Applies the saved theme now and keeps "system" in sync with the OS setting. */
export function initTheme(onChange: (mode: ThemeMode) => void): void {
  applyTheme(getThemeMode(), onChange);
  darkQuery.addEventListener("change", () => {
    if (current === "system") applyTheme("system", onChange);
  });
}

export function currentThemeMode(): ThemeMode {
  return current;
}
