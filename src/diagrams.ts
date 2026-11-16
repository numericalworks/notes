/**
 * Mermaid diagram rendering.
 *
 * Mermaid ships as a 5 MB UMD bundle that `build.ts` inlines before the app
 * script (bundling the ESM build with Bun produces a bundle that hangs in
 * Chromium, while the official UMD build is stable). Mermaid therefore arrives
 * as `window.mermaid`; this module is a thin, typed wrapper around it.
 *
 * Diagrams are rendered asynchronously after the Markdown preview is painted,
 * then cached by source + theme so typing elsewhere in a note does not
 * re-render unchanged diagrams.
 */

import { resolvedTheme } from "./theme";

interface MermaidAPI {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif';

let configuredTheme: "light" | "dark" | null = null;
let sequence = 0;

function mermaidGlobal(): MermaidAPI | null {
  const api = (globalThis as unknown as { mermaid?: MermaidAPI }).mermaid;
  return api && typeof api.render === "function" ? api : null;
}

export function configureMermaid(): void {
  const api = mermaidGlobal();
  if (!api) return;

  const theme = resolvedTheme();
  if (configuredTheme === theme) return;
  configuredTheme = theme;

  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: FONT_FAMILY,
    themeVariables: { fontFamily: FONT_FAMILY },
  });
}

export async function renderDiagram(source: string): Promise<string> {
  const api = mermaidGlobal();
  if (!api) throw new Error("Mermaid is not available in this build (built with --no-mermaid).");

  configureMermaid();
  sequence += 1;
  const { svg } = await api.render(`md-diagram-${sequence}`, source);
  return svg;
}

// Disable Mermaid's own "run on load" pass before DOMContentLoaded fires. The
// Mermaid bundle is inlined after this script, so the global may not exist yet;
// initialize again once the document finishes parsing.
configureMermaid();
document.addEventListener("DOMContentLoaded", () => configureMermaid());
