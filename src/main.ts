import { configureCharts, mountChart, type ChartConfig } from "./charts";
import { configureMermaid, preloadMermaid, renderDiagram } from "./diagrams";
import { initLayout, refreshLayout } from "./layout";
import { escapeHtml, renderMarkdown, setMathRenderer } from "./markdown";
import { renderAsciiMath } from "./math";
import { ALL_VIEW, NotesStore, TRASH_VIEW, type Note, type NoteFolder } from "./store";
import { applyTheme, currentThemeMode, initTheme, resolvedTheme, type ThemeMode } from "./theme";

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

const editor = must<HTMLTextAreaElement>("#editor");
const preview = must<HTMLElement>("#preview");
const previewTitle = must<HTMLElement>("#preview-title");
const noteList = must<HTMLElement>("#note-list");
const listTitle = must<HTMLElement>("#list-title");
const noteStamp = must<HTMLElement>("#note-stamp");
const wordCount = must<HTMLElement>("#word-count");
const searchInput = must<HTMLInputElement>("#search");
const backdrop = must<HTMLElement>("#backdrop");
const folders = must<HTMLElement>("#folders");
const emptyTrash = must<HTMLButtonElement>("#empty-trash");
const trashBanner = must<HTMLElement>("#trash-banner");
const mdToolbar = must<HTMLElement>("#md-toolbar");
const exportNote = must<HTMLButtonElement>("#export-note");
const trashNote = must<HTMLButtonElement>("#trash-note");
const moveNoteButton = must<HTMLButtonElement>("#move-note");
const movePopover = must<HTMLElement>("#move-popover");
const moveFolders = must<HTMLElement>("#move-folders");
const togglePreviewButton = must<HTMLButtonElement>("#toggle-preview");
const focusPreviewButton = must<HTMLButtonElement>("#focus-preview");
const toggleLeftButton = must<HTMLButtonElement>("#toggle-left");

const toolbarButtons = Array.from(mdToolbar.querySelectorAll<HTMLButtonElement>("button"));
const themeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme-mode]"));
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));

const store = new NotesStore();
let query = "";

// AsciiMath runs through the DOM (MathML), so it is installed at boot rather
// than imported by the DOM-free Markdown parser.
setMathRenderer({ render: renderAsciiMath });

let editingFolderId: string | null = null;
let creatingFolder = false;

const FOLDER_ICON =
  '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.4A1.4 1.4 0 0 1 4.4 5h3l1.4 1.8h6.8A1.4 1.4 0 0 1 17 8.2v6.4a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 14.6z"/></svg>';
const TRASH_ICON =
  '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.2h11M8.2 6.2V4.6h3.6v1.6M6.2 6.2l.6 9.2h6.4l.6-9.2"/></svg>';
const PLUS_ICON =
  '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>';
const PENCIL_ICON =
  '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.4 3.9l3.7 3.7M4 16l.9-3.6 7.9-7.9a1 1 0 0 1 1.4 0l1.3 1.3a1 1 0 0 1 0 1.4l-7.9 7.9z"/></svg>';
const CHECK_ICON =
  '<svg class="icon check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function deriveTitle(note: Note | null): string {
  if (!note) return "New Note";
  const first = note.body.split("\n").find((line) => line.trim()) ?? "";
  const title = first
    .replace(/[*`~]/g, "")
    .trim()
    .replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
    .trim();
  return title || "New Note";
}

function snippet(note: Note): string {
  const text = note.body
    .split("\n")
    .slice(1)
    .join(" ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 110) || "No additional text";
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < 45_000) return "Just now";
  if (diff < hour) return relativeFormat.format(-Math.round(diff / minute), "minute");
  if (diff < day) return relativeFormat.format(-Math.round(diff / hour), "hour");
  if (diff < 7 * day) return relativeFormat.format(-Math.round(diff / day), "day");

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatFull(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "note";
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderChrome(): void {
  const counts = store.counts();
  listTitle.textContent =
    store.view === TRASH_VIEW
      ? "Recently Deleted"
      : store.view === ALL_VIEW
        ? "All Notes"
        : store.folderName(store.view);
  emptyTrash.hidden = store.view !== TRASH_VIEW || counts.trash === 0;

  const note = store.active();
  previewTitle.textContent = note ? deriveTitle(note) : "";
  syncThemeButtons();
  syncViewButtons();
}

function folderRow(folder: NoteFolder | { id: string; name: string }, count: number, icon: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "folder-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "folder";
  button.dataset.folder = folder.id;
  button.setAttribute("aria-current", String(store.view === folder.id));
  button.innerHTML = `${icon}<span class="folder-name">${escapeHtml(folder.name)}</span><span class="count">${count}</span>`;
  row.appendChild(button);

  // User folders can be renamed or deleted from hover actions.
  if (folder.id !== ALL_VIEW && folder.id !== TRASH_VIEW) {
    const actions = document.createElement("div");
    actions.className = "folder-actions";

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "folder-action";
    rename.dataset.renameFolder = folder.id;
    rename.title = "Rename folder";
    rename.setAttribute("aria-label", `Rename ${folder.name}`);
    rename.innerHTML = PENCIL_ICON;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "folder-action danger";
    remove.dataset.deleteFolder = folder.id;
    remove.title = "Delete folder";
    remove.setAttribute("aria-label", `Delete ${folder.name}`);
    remove.innerHTML = TRASH_ICON;

    actions.append(rename, remove);
    row.appendChild(actions);
  }

  return row;
}

function folderInput(value: string, target: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "folder-row folder-row-editing";

  const icon = document.createElement("span");
  icon.className = "folder-glyph";
  icon.innerHTML = FOLDER_ICON;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "folder-input";
  input.value = value;
  input.dataset.folderInput = target;
  input.placeholder = "Folder name";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Folder name");

  row.append(icon, input);
  return row;
}

function renderFolders(): void {
  const counts = store.folderCounts();
  const totals = store.counts();
  const fragment = document.createDocumentFragment();

  // "New Folder" sits at the top of the list, above every folder view.
  if (creatingFolder) {
    fragment.appendChild(folderInput("", "new"));
  } else {
    const row = document.createElement("div");
    row.className = "folder-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder folder-new";
    button.id = "new-folder-row";
    button.innerHTML = `${PLUS_ICON}<span class="folder-name">New Folder</span>`;
    row.appendChild(button);
    fragment.appendChild(row);
  }

  fragment.appendChild(folderRow({ id: ALL_VIEW, name: "All Notes" }, totals.notes, FOLDER_ICON));

  for (const folder of store.folders) {
    fragment.appendChild(
      editingFolderId === folder.id
        ? folderInput(folder.name, folder.id)
        : folderRow(folder, counts[folder.id] ?? 0, FOLDER_ICON),
    );
  }

  const separator = document.createElement("div");
  separator.className = "folders-sep";
  fragment.appendChild(separator);

  fragment.appendChild(folderRow({ id: TRASH_VIEW, name: "Recently Deleted" }, totals.trash, TRASH_ICON));

  folders.replaceChildren(fragment);

  const input = folders.querySelector<HTMLInputElement>(".folder-input");
  if (input && document.activeElement !== input) {
    input.focus();
    input.select();
  }
}

function renderList(): void {
  const notes = store.visible(query);
  const fragment = document.createDocumentFragment();

  if (notes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = query.trim()
      ? `No notes match “${query.trim()}”.`
      : store.view === TRASH_VIEW
        ? "Recently Deleted is empty."
        : store.view === ALL_VIEW
          ? "No notes yet. Start typing to create one."
          : "This folder is empty. Start typing to add a note.";
    fragment.appendChild(empty);
  } else {
    for (const note of notes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "note-row";
      row.dataset.id = note.id;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(note.id === store.selectedId));

      const stamp = store.view === TRASH_VIEW ? (note.deletedAt ?? note.updatedAt) : note.updatedAt;
      row.innerHTML =
        `<span class="note-title">${escapeHtml(deriveTitle(note))}</span>` +
        `<span class="note-meta">${escapeHtml(formatRelative(stamp))} · ${escapeHtml(snippet(note))}</span>`;

      fragment.appendChild(row);
    }
  }

  noteList.replaceChildren(fragment);
}

function renderEditor(): void {
  const note = store.active();
  const inTrash = store.view === TRASH_VIEW;
  const hasNote = note !== null;

  // With no note selected (for example a brand new folder), the editor doubles as a
  // compose area: the first keystroke creates the note.
  editor.readOnly = inTrash;
  editor.placeholder = hasNote
    ? "Start writing. Markdown is supported."
    : inTrash
      ? "No deleted notes."
      : store.view === ALL_VIEW
        ? "Start typing to create a note."
        : `“${store.folderName(store.view)}” is empty — start typing to add a note.`;

  const body = note ? note.body : "";
  if (editor.value !== body) editor.value = body;

  trashBanner.hidden = !(hasNote && inTrash);
  for (const button of toolbarButtons) button.disabled = inTrash;
  exportNote.disabled = !hasNote;
  trashNote.disabled = !hasNote || inTrash;
  trashNote.hidden = inTrash;
  moveNoteButton.hidden = inTrash;
  moveNoteButton.disabled = !hasNote || inTrash;

  noteStamp.textContent = note
    ? inTrash
      ? `Deleted ${formatRelative(note.deletedAt ?? note.updatedAt)}`
      : `Edited ${formatFull(note.updatedAt)}`
    : "";

  updateWordCount();
}

function renderPreview(): void {
  previewGeneration += 1;
  destroyCharts();
  const note = store.active();
  const html = note ? renderMarkdown(note.body) : "";

  if (html) {
    preview.innerHTML = html;
    renderDiagrams();
    renderCharts();
    return;
  }

  const message = !note
    ? store.view === TRASH_VIEW
      ? "Recently Deleted is empty."
      : "Start typing on the left and the rendered note appears here."
    : "Nothing to preview yet — start typing on the left.";
  preview.innerHTML = `<div class="pane-empty">${escapeHtml(message)}</div>`;
}

function renderAll(): void {
  hideMovePopover();
  renderChrome();
  renderFolders();
  renderList();
  renderEditor();
  renderPreview();
}

/* ------------------------------------------------------------------ *
 * Mermaid diagrams
 * ------------------------------------------------------------------ */

let previewGeneration = 0;

const diagramCache = new Map<string, string>();
const DIAGRAM_CACHE_LIMIT = 32;
let diagramTimer: ReturnType<typeof setTimeout> | null = null;

function diagramKey(source: string): string {
  return `${resolvedTheme()}\u0000${source}`;
}

function cacheDiagram(key: string, svg: string): void {
  diagramCache.set(key, svg);
  while (diagramCache.size > DIAGRAM_CACHE_LIMIT) {
    const oldest = diagramCache.keys().next().value;
    if (oldest === undefined) break;
    diagramCache.delete(oldest);
  }
}

/**
 * Exposes what the browser actually produced for the most recent diagram, so a
 * degenerate render can be reported with one line: `__notesLastDiagram`.
 */
function reportDiagram(node: HTMLElement): void {
  const svg = node.querySelector<SVGSVGElement>("svg");
  if (!svg) return;

  const box = svg.getBoundingClientRect();
  const nodes = Array.from(svg.querySelectorAll("g.node"));
  const edges = Array.from(svg.querySelectorAll("g.edgeLabel text"));

  const report = {
    build: document.querySelector('meta[name="notes-build"]')?.getAttribute("content") ?? null,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewportScale: window.visualViewport?.scale ?? null,
    viewBox: svg.getAttribute("viewBox"),
    rendered: `${Math.round(box.width)}x${Math.round(box.height)}`,
    paneWidth: node.clientWidth,
    bodyFontSize: getComputedStyle(document.body).fontSize,
    nodes: nodes.map((group) => ({
      at: group.getAttribute("transform"),
      shape: (() => {
        const shape = group.querySelector("rect, polygon, circle, ellipse");
        return shape
          ? `${shape.getAttribute("width") ?? shape.getAttribute("r") ?? "?"}x${shape.getAttribute("height") ?? "?"}`
          : null;
      })(),
    })),
    edgeLabels: edges.map((text) => {
      const label = text.getBoundingClientRect();
      return {
        text: text.textContent?.trim() ?? "",
        drawn: `${Math.round(label.width)}x${Math.round(label.height)}`,
        fontSize: getComputedStyle(text).fontSize,
      };
    }),
  };

  (window as unknown as { __notesLastDiagram?: unknown }).__notesLastDiagram = report;

  // Surface pathological layouts in the console with their measurements attached.
  const viewBox = svg.viewBox.baseVal;
  const nodeHeightSum = nodes.reduce((sum, group) => {
    const shape = group.querySelector("rect, polygon, circle, ellipse");
    return sum + Number(shape?.getAttribute("height") ?? 0);
  }, 0);
  if (viewBox && nodeHeightSum > 0 && viewBox.height > nodeHeightSum * 6) {
    console.warn("[notes] degenerate Mermaid layout", report);
  }
}

function renderDiagrams(): void {
  const nodes = Array.from(preview.querySelectorAll<HTMLElement>(".md-mermaid[data-diagram]"));
  if (nodes.length === 0) return;

  const generation = previewGeneration;
  const pending: HTMLElement[] = [];

  // Cached SVGs are injected synchronously, so editing elsewhere never flashes.
  for (const node of nodes) {
    const cached = diagramCache.get(diagramKey(node.dataset.diagram ?? ""));
    if (cached) {
      node.innerHTML = cached;
      node.classList.add("is-ready");
      reportDiagram(node);
    } else {
      node.classList.remove("is-ready", "is-error");
      pending.push(node);
    }
  }

  if (pending.length === 0) return;

  // Inflating the bundled Mermaid takes a moment; start it while the debounce runs.
  preloadMermaid();

  if (diagramTimer !== null) clearTimeout(diagramTimer);
  diagramTimer = setTimeout(() => {
    diagramTimer = null;
    if (generation !== previewGeneration) return;

    for (const node of pending) {
      if (!node.isConnected) continue;
      const source = node.dataset.diagram ?? "";
      const key = diagramKey(source);

      renderDiagram(source)
        .then((svg) => {
          cacheDiagram(key, svg);
          if (generation === previewGeneration && node.isConnected) {
            node.innerHTML = svg;
            node.classList.add("is-ready");
            reportDiagram(node);
          }
        })
        .catch((error: unknown) => {
          if (generation !== previewGeneration || !node.isConnected) return;
          node.classList.add("is-error");
          node.innerHTML =
            '<div class="md-diagram-error"><strong>Could not render this diagram</strong>' +
            `<pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre></div>`;
        });
    }
  }, 200);
}

/* ------------------------------------------------------------------ *
 * Chart.js charts
 * ------------------------------------------------------------------ */

let mountedCharts: { destroy(): void }[] = [];
let chartTimer: ReturnType<typeof setTimeout> | null = null;

function destroyCharts(): void {
  if (chartTimer !== null) {
    clearTimeout(chartTimer);
    chartTimer = null;
  }
  for (const chart of mountedCharts) {
    try {
      chart.destroy();
    } catch {
      // Already gone with the DOM node; nothing to clean up.
    }
  }
  mountedCharts = [];
}

function showChartError(node: HTMLElement, error: unknown): void {
  node.classList.add("is-error");
  node.innerHTML =
    '<div class="md-chart-error"><strong>Could not render this chart</strong>' +
    `<pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre></div>`;
}

function renderCharts(): void {
  const nodes = Array.from(preview.querySelectorAll<HTMLElement>(".md-chart[data-chart]"));
  if (nodes.length === 0) return;

  const generation = previewGeneration;

  for (const node of nodes) {
    if (!node.querySelector(".md-chart-placeholder, .md-chart-error")) {
      node.innerHTML = '<div class="md-chart-placeholder">Rendering chart…</div>';
    }
  }

  if (chartTimer !== null) clearTimeout(chartTimer);
  chartTimer = setTimeout(() => {
    chartTimer = null;
    if (generation !== previewGeneration) return;

    for (const node of nodes) {
      if (!node.isConnected) continue;

      let config: unknown;
      try {
        config = JSON.parse(node.dataset.chart ?? "");
      } catch (error) {
        showChartError(node, error);
        continue;
      }

      if (typeof config !== "object" || config === null || Array.isArray(config)) {
        showChartError(node, new Error("A chart block must contain a JSON object, for example { \"type\": \"bar\", … }."));
        continue;
      }

      const canvas = document.createElement("canvas");
      node.classList.remove("is-error");
      node.replaceChildren(canvas);

      try {
        mountedCharts.push(mountChart(canvas, config as ChartConfig));
      } catch (error) {
        showChartError(node, error);
      }
    }
  }, 200);
}

/* ------------------------------------------------------------------ *
 * Throttled live updates
 * ------------------------------------------------------------------ */

let previewFrame = 0;
let listTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePreview(): void {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    renderPreview();
  });
}

function scheduleList(): void {
  if (listTimer !== null) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    renderList();
  }, 140);
}

function updateWordCount(): void {
  const text = editor.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCount.textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
}

/* ------------------------------------------------------------------ *
 * Editor behaviour
 * ------------------------------------------------------------------ */

function applyEditorValue(value: string, selectionStart: number, selectionEnd = selectionStart): void {
  editor.value = value;
  editor.focus();
  editor.setSelectionRange(selectionStart, selectionEnd);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function wrapSelection(before: string, after: string, placeholder: string): void {
  const { selectionStart, selectionEnd, value } = editor;
  const selected = value.slice(selectionStart, selectionEnd) || placeholder;
  const next = value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
  applyEditorValue(next, selectionStart + before.length, selectionStart + before.length + selected.length);
}

function prefixLines(prefix: string): void {
  const { selectionStart, selectionEnd, value } = editor;
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  let lineEnd = value.indexOf("\n", selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const everyLinePrefixed = lines.every((line) => !line.trim() || line.startsWith(prefix));

  const updated = lines
    .map((line) => {
      if (!line.trim()) return line;
      return everyLinePrefixed ? line.slice(prefix.length) : prefix + line;
    })
    .join("\n");

  const next = value.slice(0, lineStart) + updated + value.slice(lineEnd);
  applyEditorValue(next, lineStart, lineStart + updated.length);
}

function insertLink(): void {
  const { selectionStart, selectionEnd, value } = editor;
  const selected = value.slice(selectionStart, selectionEnd);
  const label = selected || "text";
  const inserted = `[${label}](url)`;
  const next = value.slice(0, selectionStart) + inserted + value.slice(selectionEnd);
  const urlStart = selectionStart + label.length + 3;
  applyEditorValue(next, urlStart, urlStart + 3);
}

function runFormat(action: string): void {
  if (editor.readOnly) return;
  switch (action) {
    case "bold":
      wrapSelection("**", "**", "bold text");
      break;
    case "italic":
      wrapSelection("*", "*", "italic text");
      break;
    case "strike":
      wrapSelection("~~", "~~", "strikethrough");
      break;
    case "code":
      wrapSelection("`", "`", "code");
      break;
    case "heading":
      prefixLines("## ");
      break;
    case "quote":
      prefixLines("> ");
      break;
    case "list":
      prefixLines("- ");
      break;
    case "ordered":
      prefixLines("1. ");
      break;
    case "task":
      prefixLines("- [ ] ");
      break;
    case "link":
      insertLink();
      break;
    default:
      break;
  }
}

editor.addEventListener("input", () => {
  if (store.view === TRASH_VIEW) return;

  // Typing into the empty editor of an empty folder creates the note on the fly.
  const composing = store.active() === null;
  const note = composing ? store.create() : store.active();
  if (!note) return;

  store.updateBody(note.id, editor.value);

  if (composing) {
    // First keystroke: surface the new note in the list, counts and toolbar.
    renderAll();
  } else {
    noteStamp.textContent = `Edited ${formatFull(note.updatedAt)}`;
    previewTitle.textContent = deriveTitle(note);
    updateWordCount();
    schedulePreview();
    scheduleList();
  }
});

editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !editor.readOnly) {
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = editor;
    const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
    applyEditorValue(next, selectionStart + 2);
    return;
  }

  if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
  if (editor.readOnly) return;

  const { selectionStart, selectionEnd, value } = editor;
  if (selectionStart !== selectionEnd) return;

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const line = value.slice(lineStart, selectionStart);

  // Never auto-continue a list inside a fenced code block.
  const fences = value.slice(0, selectionStart).match(/^\s*(?:```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return;

  const marker = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)([.)])\s+)/.exec(line);
  if (!marker) return;

  const indent = marker[1] ?? "";
  const bullet = marker[2];
  const task = marker[3];
  const number = marker[4];
  const delimiter = marker[5];
  const content = line.slice(marker[0].length);

  event.preventDefault();

  // Pressing Enter on an empty list item ends the list instead of adding a new one.
  if (!content.trim()) {
    const next = value.slice(0, lineStart) + value.slice(selectionStart);
    applyEditorValue(next, lineStart);
    return;
  }

  const prefix = number
    ? `${indent}${Number(number) + 1}${delimiter ?? "."} `
    : `${indent}${bullet} ${task ? "[ ] " : ""}`;
  const insertion = `\n${prefix}`;
  const next = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
  applyEditorValue(next, selectionStart + insertion.length);
});

mdToolbar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-md]");
  if (!button || button.disabled || !button.dataset.md) return;
  editor.focus();
  runFormat(button.dataset.md);
});

/* ------------------------------------------------------------------ *
 * Notes list / folders / search
 * ------------------------------------------------------------------ */

function closeDrawers(): void {
  delete document.body.dataset.drawer;
}

noteList.addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>(".note-row");
  if (!row?.dataset.id) return;

  store.select(row.dataset.id);
  renderChrome();
  renderList();
  renderEditor();
  renderPreview();
  editor.focus();
  closeDrawers();
});

function startCreatingFolder(): void {
  creatingFolder = true;
  editingFolderId = null;
  renderFolders();
}

function cancelFolderEdit(): void {
  creatingFolder = false;
  editingFolderId = null;
  renderFolders();
}

function commitFolderEdit(input: HTMLInputElement, focusEditor = false): void {
  const target = input.dataset.folderInput;
  const name = input.value.trim();

  if (target === "new") {
    creatingFolder = false;
    if (!name) {
      renderFolders();
      return;
    }
    store.createFolder(name);
    renderAll();
    if (focusEditor) editor.focus();
    return;
  }

  if (!target) return;
  editingFolderId = null;
  if (name) store.renameFolder(target, name);
  renderAll();
}

folders.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;

  const remove = target.closest<HTMLButtonElement>("[data-delete-folder]");
  if (remove?.dataset.deleteFolder) {
    const id = remove.dataset.deleteFolder;
    const name = store.folderName(id);
    if (window.confirm(`Delete “${name}”? Its notes will move to Recently Deleted.`)) {
      store.deleteFolder(id);
      renderAll();
    }
    return;
  }

  const rename = target.closest<HTMLButtonElement>("[data-rename-folder]");
  if (rename?.dataset.renameFolder) {
    editingFolderId = rename.dataset.renameFolder;
    creatingFolder = false;
    renderFolders();
    return;
  }

  if (target.closest("#new-folder-row")) {
    startCreatingFolder();
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-folder]");
  const view = button?.dataset.folder;
  if (!view) return;

  store.setView(view);
  query = "";
  searchInput.value = "";
  editingFolderId = null;
  creatingFolder = false;
  renderAll();
  editor.focus();
  closeDrawers();
});

must<HTMLButtonElement>("#new-folder").addEventListener("click", startCreatingFolder);

folders.addEventListener("keydown", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.classList.contains("folder-input")) return;

  if (event.key === "Escape") {
    event.preventDefault();
    cancelFolderEdit();
  } else if (event.key === "Enter") {
    event.preventDefault();
    commitFolderEdit(input, true);
  }
});

folders.addEventListener("focusout", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.classList.contains("folder-input")) return;

  // Commit once focus has really left the input (clicks on other folders land first).
  requestAnimationFrame(() => {
    if (input.isConnected && document.activeElement !== input) commitFolderEdit(input);
  });
});

/* ------------------------------------------------------------------ *
 * Move-to-folder popover
 * ------------------------------------------------------------------ */

function hideMovePopover(): void {
  movePopover.hidden = true;
}

function renderMoveFolders(): void {
  const note = store.active();
  if (!note) return;

  moveFolders.innerHTML = store.folders
    .map((folder) => {
      const current = folder.id === note.folderId;
      return (
        `<button type="button" class="popover-item" data-move-to="${folder.id}">` +
        FOLDER_ICON +
        `<span class="folder-name">${escapeHtml(folder.name)}</span>` +
        (current ? CHECK_ICON : "") +
        "</button>"
      );
    })
    .join("");
}

moveNoteButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!movePopover.hidden) {
    hideMovePopover();
    return;
  }
  renderMoveFolders();
  movePopover.hidden = false;
});

moveFolders.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-move-to]");
  const folderId = button?.dataset.moveTo;
  const note = store.active();
  if (!folderId || !note) return;

  store.moveNote(note.id, folderId);
  renderAll();
  editor.focus();
});

document.addEventListener("click", (event) => {
  if (movePopover.hidden) return;
  const target = event.target as Node;
  if (movePopover.contains(target) || moveNoteButton.contains(target)) return;
  hideMovePopover();
});

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  renderList();
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  searchInput.value = "";
  query = "";
  renderList();
  searchInput.blur();
});

function newNote(): void {
  store.create();
  query = "";
  searchInput.value = "";
  renderAll();
  closeDrawers();
  editor.focus();
}

for (const id of ["#new-note", "#new-note-side", "#new-note-mobile"]) {
  must<HTMLButtonElement>(id).addEventListener("click", newNote);
}

emptyTrash.addEventListener("click", () => {
  const { trash } = store.counts();
  if (trash === 0) return;
  if (!window.confirm("Delete all notes in Recently Deleted? This cannot be undone.")) return;
  store.emptyTrash();
  renderAll();
});

trashNote.addEventListener("click", () => {
  const note = store.active();
  if (!note) return;
  store.trash(note.id);
  renderAll();
  editor.focus();
});

must<HTMLButtonElement>("#restore-note").addEventListener("click", () => {
  const note = store.active();
  if (!note) return;
  store.restore(note.id);
  renderAll();
  editor.focus();
});

must<HTMLButtonElement>("#delete-forever").addEventListener("click", () => {
  const note = store.active();
  if (!note) return;
  if (!window.confirm("Delete this note permanently? This cannot be undone.")) return;
  store.destroy(note.id);
  renderAll();
});

exportNote.addEventListener("click", () => {
  const note = store.active();
  if (!note) return;

  const blob = new Blob([note.body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(deriveTitle(note))}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ------------------------------------------------------------------ *
 * Preview extras
 * ------------------------------------------------------------------ */

preview.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
  if (!button) return;

  const code = button.closest(".md-code-block")?.querySelector("code");
  if (!code) return;

  try {
    await navigator.clipboard.writeText(code.textContent ?? "");
    button.textContent = "Copied";
  } catch {
    button.textContent = "Failed";
  }
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1400);
});

let scrollSyncAt = 0;

function syncScroll(source: HTMLElement, target: HTMLElement): void {
  const now = Date.now();
  if (now - scrollSyncAt < 70) return;

  const sourceMax = source.scrollHeight - source.clientHeight;
  const targetMax = target.scrollHeight - target.clientHeight;
  if (sourceMax <= 0 || targetMax <= 0) return;

  scrollSyncAt = now;
  target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
}

editor.addEventListener("scroll", () => syncScroll(editor, preview), { passive: true });
preview.addEventListener("scroll", () => syncScroll(preview, editor), { passive: true });

/* ------------------------------------------------------------------ *
 * Theme, drawers, shortcuts
 * ------------------------------------------------------------------ */

function syncThemeButtons(): void {
  const mode = currentThemeMode();
  for (const button of themeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.themeMode === mode));
  }
}

function syncViewButtons(): void {
  const view = document.body.dataset.view ?? "edit";
  for (const button of viewButtons) {
    button.setAttribute("aria-pressed", String((button.dataset.view ?? "edit") === view));
  }
}

function handleThemeChange(): void {
  syncThemeButtons();
  // Diagrams and charts bake theme colours into what they render, so both need a
  // fresh configuration and the preview needs to be rebuilt.
  configureMermaid();
  configureCharts();
  renderPreview();
}

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.themeMode;
    if (mode === "system" || mode === "light" || mode === "dark") applyTheme(mode as ThemeMode, handleThemeChange);
  });
}

initTheme(handleThemeChange);

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.view === "preview" ? "preview" : "edit";
    document.body.dataset.view = view;
    syncViewButtons();
  });
}

/* ------------------------------------------------------------------ *
 * Left panes (folders + notes list) visibility
 * ------------------------------------------------------------------ */

const LEFT_KEY = "notes.left";

function readLeftVisible(): boolean {
  try {
    return localStorage.getItem(LEFT_KEY) !== "hidden";
  } catch {
    return true;
  }
}

let leftVisible = readLeftVisible();

function applyLeftUI(): void {
  document.body.dataset.left = leftVisible ? "shown" : "hidden";
  toggleLeftButton.setAttribute("aria-pressed", String(leftVisible));
  toggleLeftButton.title = leftVisible ? "Hide sidebar (⌘⇧\\)" : "Show sidebar (⌘⇧\\)";
  toggleLeftButton.setAttribute("aria-label", leftVisible ? "Hide sidebar" : "Show sidebar");

  refreshLayout();
}

function toggleLeftPanes(): void {
  leftVisible = !leftVisible;
  try {
    localStorage.setItem(LEFT_KEY, leftVisible ? "shown" : "hidden");
  } catch {
    // Ignore unavailable storage.
  }
  applyLeftUI();

  if (!leftVisible) {
    closeDrawers();
    if (editor.offsetParent !== null) editor.focus();
  }
}

toggleLeftButton.addEventListener("click", toggleLeftPanes);

/* ------------------------------------------------------------------ *
 * Preview visibility and full-screen reading mode
 * ------------------------------------------------------------------ */

type PreviewMode = "split" | "hidden";

const PREVIEW_KEY = "notes.preview";

function readPreviewMode(): PreviewMode {
  try {
    return localStorage.getItem(PREVIEW_KEY) === "hidden" ? "hidden" : "split";
  } catch {
    return "split";
  }
}

let previewMode: PreviewMode = readPreviewMode();
let fullScreenPreview = false;

function applyPreviewUI(): void {
  document.body.dataset.preview = previewMode;
  document.body.dataset.focusPreview = String(fullScreenPreview);

  const isSplit = previewMode === "split";
  togglePreviewButton.setAttribute("aria-pressed", String(isSplit));
  togglePreviewButton.title = isSplit ? "Hide preview (⌘\\)" : "Show preview (⌘\\)";
  togglePreviewButton.setAttribute("aria-label", isSplit ? "Hide preview" : "Show preview");

  focusPreviewButton.setAttribute("aria-pressed", String(fullScreenPreview));
  focusPreviewButton.title = fullScreenPreview
    ? "Exit full-screen preview (Esc)"
    : "Full-screen preview (⌘⇧P)";
  focusPreviewButton.setAttribute(
    "aria-label",
    fullScreenPreview ? "Exit full-screen preview" : "Full-screen preview",
  );

  refreshLayout();
}

function setPreviewMode(mode: PreviewMode): void {
  previewMode = mode;
  try {
    localStorage.setItem(PREVIEW_KEY, mode);
  } catch {
    // Ignore unavailable storage.
  }
  applyPreviewUI();
}

function setFullScreenPreview(on: boolean): void {
  if (on && previewMode === "hidden") setPreviewMode("split");
  fullScreenPreview = on;
  applyPreviewUI();

  if (on) {
    hideMovePopover();
    closeDrawers();
    preview.focus({ preventScroll: true });
  } else if (editor.offsetParent !== null) {
    editor.focus();
  }
}

function togglePreviewPane(): void {
  if (fullScreenPreview) {
    setFullScreenPreview(false);
    return;
  }
  setPreviewMode(previewMode === "split" ? "hidden" : "split");
}

togglePreviewButton.addEventListener("click", togglePreviewPane);
focusPreviewButton.addEventListener("click", () => setFullScreenPreview(!fullScreenPreview));

must<HTMLButtonElement>("#toggle-sidebar").addEventListener("click", () => {
  document.body.dataset.drawer = "sidebar";
});

must<HTMLButtonElement>("#toggle-list").addEventListener("click", () => {
  document.body.dataset.drawer = "list";
});

backdrop.addEventListener("click", closeDrawers);

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (mod && event.code === "Backslash") {
    event.preventDefault();
    if (event.shiftKey) toggleLeftPanes();
    else togglePreviewPane();
    return;
  }

  if (mod && event.shiftKey && key === "p") {
    event.preventDefault();
    setFullScreenPreview(!fullScreenPreview);
    return;
  }

  if (mod && key === "k") {
    event.preventDefault();
    closeDrawers();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (event.altKey && key === "n" && !mod) {
    event.preventDefault();
    newNote();
    return;
  }

  if (document.activeElement === editor && mod && (key === "b" || key === "i")) {
    event.preventDefault();
    runFormat(key === "b" ? "bold" : "italic");
    return;
  }

  if (event.key === "Escape") {
    if (fullScreenPreview) {
      event.preventDefault();
      setFullScreenPreview(false);
      return;
    }
    hideMovePopover();
    closeDrawers();
  }
});

/* ------------------------------------------------------------------ *
 * Persist on the way out
 * ------------------------------------------------------------------ */

window.addEventListener("pagehide", () => store.flush());
window.addEventListener("beforeunload", () => store.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.flush();
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

document.body.dataset.view = "edit";

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const searchHint = document.querySelector<HTMLElement>(".search-field kbd");
if (searchHint) searchHint.textContent = isMac ? "⌘K" : "Ctrl K";

applyPreviewUI();
applyLeftUI();
initLayout();
renderAll();
