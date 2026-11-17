/**
 * Chart.js rendering.
 *
 * Like Mermaid, Chart.js is embedded by `build.ts` as a gzip+base64 payload and
 * inflated on first use, so it arrives as `window.Chart`. Blocks tagged `chart`
 * contain a JSON Chart.js config; this module parses nothing — it applies the
 * app's theme defaults and mounts the chart on a canvas supplied by the preview.
 */

import { loadInlineBundle } from "./assets";
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

const BUNDLE_SCRIPT_ID = "chartjs-bundle";

let configuredTheme: "light" | "dark" | null = null;
let loading: Promise<ChartGlobal | null> | null = null;

function chartGlobal(): ChartGlobal | null {
  const api = (globalThis as unknown as { Chart?: ChartGlobal }).Chart;
  return typeof api === "function" ? api : null;
}

/**
 * Resolves with Chart.js, inflating and starting the bundled copy on demand.
 * Returns `null` when the bundle was not included.
 */
function ensureCharts(): Promise<ChartGlobal | null> {
  const loaded = chartGlobal();
  if (loaded) return Promise.resolve(loaded);

  loading ??= loadInlineBundle(BUNDLE_SCRIPT_ID)
    .then(() => {
      configureCharts();
      return chartGlobal();
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Starts inflating the bundle while the preview debounce runs. */
export function preloadCharts(): void {
  ensureCharts().catch(() => {
    // The render path reports the failure in the chart block itself.
  });
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

export async function mountChart(canvas: HTMLCanvasElement, config: ChartConfig): Promise<ChartInstance> {
  const api = await ensureCharts();
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
