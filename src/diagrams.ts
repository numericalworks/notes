/**
 * Mermaid diagram rendering.
 *
 * Mermaid ships as a ~5 MB UMD bundle that `build.ts` inlines before the app
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
  render(id: string, text: string, container?: Element): Promise<{ svg: string }>;
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif';

/** Matches the preview's body text, so labels stay legible at natural size. */
const FONT_SIZE = "15px";

/**
 * `useMaxWidth: false` keeps each diagram at its natural size instead of
 * `width: 100%`, so the app can scale it to the pane itself.
 *
 * Mermaid 12 defaults to `minNodeWidth: 120`, which makes even a two-word node
 * a 150 px block; with several nodes per rank that pushes a small flowchart to
 * 550 px wide, where it has to be shrunk to fit a pane and looks tiny and
 * sparse. `minNodeWidth`/`wrappingWidth` let nodes hug their labels.
 */
const DIAGRAM_CONFIG: Record<string, unknown> = {
  /** The classic renderer is the one used by GitHub et al. and is far better tested than Mermaid 12's new "neo" look. */
  look: "classic",
  /**
   * Top-level on purpose: `getEffectiveHtmlLabels` reads `config.htmlLabels` first and
   * only falls back to the (deprecated) `flowchart.htmlLabels`. With HTML labels,
   * Mermaid sizes nodes by measuring an HTML node inside a <foreignObject>, which in
   * some browser/font setups reports absurd dimensions — a three-node chart then gets
   * laid out with 2500 px between ranks. SVG <text> labels are measured with getBBox
   * and are stable everywhere.
   */
  htmlLabels: false,
  flowchart: {
    useMaxWidth: false,
    minNodeWidth: 40,
    wrappingWidth: 240,
    nodeSpacing: 35,
    rankSpacing: 40,
    padding: 6,
    diagramPadding: 4,
  },
  sequence: { useMaxWidth: false },
  class: { useMaxWidth: false },
  state: { useMaxWidth: false },
  er: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
  journey: { useMaxWidth: false },
  pie: { useMaxWidth: false },
  gitGraph: { useMaxWidth: false },
  mindmap: { useMaxWidth: false },
  timeline: { useMaxWidth: false },
  quadrantChart: { useMaxWidth: false },
  requirement: { useMaxWidth: false },
  xychart: { useMaxWidth: false },
  block: { useMaxWidth: false },
  packet: { useMaxWidth: false },
  architecture: { useMaxWidth: false },
  radar: { useMaxWidth: false },
  treemap: { useMaxWidth: false },
  sankey: { useMaxWidth: false },
  ishikawa: { useMaxWidth: false },
  venn: { useMaxWidth: false },
};

let configuredTheme: "light" | "dark" | null = null;
let sequence = 0;
let measureHost: HTMLDivElement | null = null;

/**
 * Mermaid measures labels by appending a temporary <svg> to the document. Point it at
 * a dedicated off-screen container with plain styles instead of <body>, so the app's
 * CSS (font size, overflow, layout) cannot influence diagram geometry.
 */
function measurementHost(): HTMLDivElement {
  if (measureHost?.isConnected) return measureHost;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;top:0;left:-12000px;width:1000px;height:0;overflow:visible;pointer-events:none;contain:layout style;";
  document.body.appendChild(host);
  measureHost = host;
  return host;
}

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
    themeVariables: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE },
    ...DIAGRAM_CONFIG,
  });
}

/**
 * Mermaid occasionally lays out nodes with widths far smaller than it then draws
 * them (label measurement can report a bogus size in some browsers), which leaves
 * a viewBox too small for the shapes and collapses the diagram to a sliver.
 *
 * This expands the viewBox to the union of the drawn node shapes. It uses only
 * attribute values plus the node transforms — no layout APIs — and it can only
 * ever grow the canvas, never shrink it, so healthy diagrams are untouched.
 */
function expandViewBoxToNodes(svg: SVGSVGElement): void {
  const viewBox = svg.viewBox.baseVal;
  if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const node of Array.from(svg.querySelectorAll("g.node"))) {
    const offset = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(node.getAttribute("transform") ?? "");
    if (!offset) continue;
    const tx = Number(offset[1]);
    const ty = Number(offset[2]);

    const shape = node.querySelector("rect, polygon, circle, ellipse");
    if (!shape) continue;

    const tag = shape.tagName.toLowerCase();
    if (tag === "rect") {
      const x = Number(shape.getAttribute("x") ?? 0);
      const y = Number(shape.getAttribute("y") ?? 0);
      const width = Number(shape.getAttribute("width") ?? 0);
      const height = Number(shape.getAttribute("height") ?? 0);
      include(tx + x, ty + y);
      include(tx + x + width, ty + y + height);
    } else if (tag === "polygon") {
      const points = (shape.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < points.length; i += 2) include(tx + points[i]!, ty + points[i + 1]!);
    } else if (tag === "circle") {
      const cx = Number(shape.getAttribute("cx") ?? 0);
      const cy = Number(shape.getAttribute("cy") ?? 0);
      const r = Number(shape.getAttribute("r") ?? 0);
      include(tx + cx - r, ty + cy - r);
      include(tx + cx + r, ty + cy + r);
    } else {
      const cx = Number(shape.getAttribute("cx") ?? 0);
      const cy = Number(shape.getAttribute("cy") ?? 0);
      const rx = Number(shape.getAttribute("rx") ?? 0);
      const ry = Number(shape.getAttribute("ry") ?? 0);
      include(tx + cx - rx, ty + cy - ry);
      include(tx + cx + rx, ty + cy + ry);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const drawnWidth = maxX - minX;
  const drawnHeight = maxY - minY;
  if (drawnWidth <= 0 || drawnHeight <= 0) return;

  // A canvas far larger than the nodes themselves means Mermaid's label measurement
  // ran away; log it so browser-specific problems are visible in the console.
  if (viewBox.width > drawnWidth * 3 || viewBox.height > drawnHeight * 3) {
    console.warn("[notes] Mermaid produced an oversized canvas", {
      viewBox: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
      nodeBounds: `${minX} ${minY} ${drawnWidth} ${drawnHeight}`,
    });
  }

  if (drawnWidth <= viewBox.width * 1.15 && drawnHeight <= viewBox.height * 1.15) return;

  const pad = 8;
  const repaired = `${minX - pad} ${minY - pad} ${drawnWidth + pad * 2} ${drawnHeight + pad * 2}`;
  svg.setAttribute("viewBox", repaired);

  // Helps diagnose browser-specific label measurement problems from the console.
  console.warn("[notes] repaired a Mermaid viewBox that did not contain its nodes", {
    from: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
    to: repaired,
  });
}

/**
 * Takes over the SVG's sizing completely: drop the `width`/`height` attributes and
 * Mermaid's inline styles, keep only the viewBox, and drive the box from CSS
 * (`aspect-ratio` + a `max-width` of the natural size). Relying on intrinsic SVG
 * sizing instead behaves differently across engines and can collapse a diagram
 * into a thin strip.
 */
function normalizeSvg(markup: string): string {
  const template = document.createElement("template");
  template.innerHTML = markup;

  const svg = template.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) return markup;

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("style");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  expandViewBoxToNodes(svg);

  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = viewBox[2] ?? 0;
  const height = viewBox[3] ?? 0;

  if (viewBox.length === 4 && width > 0 && height > 0) {
    svg.style.aspectRatio = `${width} / ${height}`;
    svg.style.width = "100%";
    svg.style.maxWidth = `${Math.ceil(width)}px`;
    svg.style.height = "auto";
    svg.style.display = "block";
    svg.style.margin = "0 auto";
  }

  return svg.outerHTML;
}

export async function renderDiagram(source: string): Promise<string> {
  const api = mermaidGlobal();
  if (!api) throw new Error("Mermaid is not available in this build (built with --no-mermaid).");

  configureMermaid();
  sequence += 1;
  const { svg } = await api.render(`md-diagram-${sequence}`, source, measurementHost());
  return normalizeSvg(svg);
}

// Disable Mermaid's own "run on load" pass before DOMContentLoaded fires. The
// Mermaid bundle is inlined after this script, so the global may not exist yet;
// initialize again once the document finishes parsing.
configureMermaid();
document.addEventListener("DOMContentLoaded", () => configureMermaid());
