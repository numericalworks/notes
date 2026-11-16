/**
 * Chart.js rendering.
 *
 * Like Mermaid, Chart.js is inlined as its official UMD bundle by `build.ts`, so it
 * arrives as `window.Chart`. Blocks tagged `chart` contain a JSON Chart.js config;
 * this module parses nothing — it applies the app's theme defaults and mounts the
 * chart on a canvas supplied by the preview.
 */

import { resolvedTheme, UI_FONT_FAMILY } from "./theme";

interface ChartInstance {
  destroy(): void;
}

interface ChartGlobal {
  new (item: HTMLCanvasElement, config: Record<string, unknown>): ChartInstance;
  defaults: {
    color: string;
    borderColor: string;
    font: { family: string; size: number };
  };
}

export interface ChartConfig {
  type?: string;
  data?: unknown;
  options?: Record<string, unknown>;
  plugins?: unknown;
}

let configuredTheme: "light" | "dark" | null = null;

function chartGlobal(): ChartGlobal | null {
  const api = (globalThis as unknown as { Chart?: ChartGlobal }).Chart;
  return typeof api === "function" ? api : null;
}

export function configureCharts(): void {
  const api = chartGlobal();
  if (!api) return;

  const theme = resolvedTheme();
  if (configuredTheme === theme) return;
  configuredTheme = theme;

  api.defaults.color = theme === "dark" ? "#e8e8ed" : "#3c3c43";
  api.defaults.borderColor = theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)";
  api.defaults.font.family = UI_FONT_FAMILY;
  api.defaults.font.size = 12;
}

export function mountChart(canvas: HTMLCanvasElement, config: ChartConfig): ChartInstance {
  const api = chartGlobal();
  if (!api) throw new Error("Chart.js is not available in this build.");

  configureCharts();

  const options: Record<string, unknown> = { ...(config.options ?? {}) };
  // Charts are re-created whenever the preview re-renders, so animations would replay
  // on every keystroke. Configs can still opt back in.
  if (options.animation === undefined) options.animation = false;
  if (options.responsive === undefined) options.responsive = true;
  if (options.maintainAspectRatio === undefined) options.maintainAspectRatio = false;

  return new api(canvas, { ...config, options });
}
