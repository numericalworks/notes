/**
 * Resizable panes.
 *
 * Widths live as CSS custom properties (`--sidebar-w`, `--list-w`, `--editor-w`) so the
 * grid rules in styles.css (including the responsive ones) can keep using them. Dragging
 * a divider updates the variables, and the layout is persisted per browser.
 */

const STORAGE_KEY = "notes.layout";

/** Keep at least this much room for the preview pane when clamping. */
const MIN_PREVIEW = 280;

interface Layout {
  sidebar: number;
  list: number;
  editor: number;
}

type PaneKey = keyof Layout;

const LIMITS: Record<PaneKey, { min: number; max: number }> = {
  sidebar: { min: 176, max: 420 },
  list: { min: 220, max: 520 },
  editor: { min: 280, max: 1200 },
};

let layout: Layout = readLayout() ?? defaultLayout();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isNarrow(): boolean {
  return window.matchMedia("(max-width: 760px)").matches;
}

function isMedium(): boolean {
  return window.matchMedia("(max-width: 1180px)").matches;
}

function leftHidden(): boolean {
  return document.body.dataset.left === "hidden";
}

function previewHidden(): boolean {
  return document.body.dataset.preview === "hidden";
}

function readLayout(): Layout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Layout>;
    if (typeof data.sidebar !== "number" || typeof data.list !== "number" || typeof data.editor !== "number") {
      return null;
    }
    return { sidebar: data.sidebar, list: data.list, editor: data.editor };
  } catch {
    return null;
  }
}

function persist(next: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; resizing still works for this session.
  }
}

function defaultLayout(): Layout {
  const total = document.documentElement.clientWidth;
  const sidebar = 236;
  const list = 306;
  const remaining = Math.max(total - sidebar - list, 480);
  return { sidebar, list, editor: Math.round(remaining * 0.48) };
}

/**
 * Applies the per-pane limits and makes sure the panes that are actually on screen keep a
 * usable width. Trimming order is editor → list → sidebar, so the folder rail stays
 * recognisable. Panes that are drawers or hidden do not count towards the total.
 */
function clampLayout(input: Layout): Layout {
  const next: Layout = {
    sidebar: clamp(input.sidebar, LIMITS.sidebar.min, LIMITS.sidebar.max),
    list: clamp(input.list, LIMITS.list.min, LIMITS.list.max),
    editor: clamp(input.editor, LIMITS.editor.min, LIMITS.editor.max),
  };

  // The narrow layout is single-column (tabs + drawers), so widths are just stored.
  if (isNarrow()) return next;

  const total = document.documentElement.clientWidth;
  const showSidebar = !isMedium() && !leftHidden();
  const showList = !leftHidden();
  const showEditor = !previewHidden();

  const used =
    (showSidebar ? next.sidebar : 0) + (showList ? next.list : 0) + (showEditor ? next.editor : 0);
  const reserved = showEditor ? MIN_PREVIEW : 0;
  let overflow = used - (total - reserved);
  if (overflow <= 0) return next;

  for (const key of ["editor", "list", "sidebar"] as const) {
    if (overflow <= 0) break;
    if (key === "editor" && !showEditor) continue;
    if (key === "list" && !showList) continue;
    if (key === "sidebar" && !showSidebar) continue;

    const room = next[key] - LIMITS[key].min;
    const take = Math.min(overflow, Math.max(room, 0));
    next[key] -= take;
    overflow -= take;
  }

  return next;
}

function apply(next: Layout): void {
  const style = document.documentElement.style;
  style.setProperty("--sidebar-w", `${next.sidebar}px`);
  style.setProperty("--list-w", `${next.list}px`);
  style.setProperty("--editor-w", `${next.editor}px`);

  for (const handle of Array.from(document.querySelectorAll<HTMLElement>(".resizer"))) {
    const key = handle.dataset.resize as PaneKey | undefined;
    if (!key || !(key in LIMITS)) continue;
    handle.setAttribute("aria-valuenow", String(next[key]));
    handle.setAttribute("aria-valuemin", String(LIMITS[key].min));
    handle.setAttribute("aria-valuemax", String(LIMITS[key].max));
  }
}

function startDrag(event: PointerEvent, handle: HTMLElement, key: PaneKey): void {
  if (event.button !== 0) return;
  event.preventDefault();

  const startX = event.clientX;
  const startWidth = layout[key];

  handle.setPointerCapture(event.pointerId);
  handle.classList.add("is-dragging");
  document.body.classList.add("is-resizing");

  const move = (moveEvent: PointerEvent): void => {
    layout = clampLayout({ ...layout, [key]: startWidth + (moveEvent.clientX - startX) });
    apply(layout);
  };

  const end = (): void => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    persist(layout);
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function nudge(key: PaneKey, direction: -1 | 1, step: number): void {
  layout = clampLayout({ ...layout, [key]: layout[key] + direction * step });
  apply(layout);
  persist(layout);
}

/** Re-applies the layout after something changed which panes are on screen. */
export function refreshLayout(): void {
  layout = clampLayout(layout);
  apply(layout);
}

export function initLayout(): void {
  refreshLayout();

  for (const handle of Array.from(document.querySelectorAll<HTMLElement>(".resizer"))) {
    const key = handle.dataset.resize as PaneKey | undefined;
    if (!key || !(key in LIMITS)) continue;

    handle.addEventListener("pointerdown", (event) => startDrag(event, handle, key));

    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      nudge(key, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey ? 64 : 16);
    });

    handle.addEventListener("dblclick", () => {
      layout = clampLayout(defaultLayout());
      apply(layout);
      persist(layout);
    });
  }

  window.addEventListener("resize", refreshLayout);
}
