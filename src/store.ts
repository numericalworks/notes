/** Note persistence, folders and ordering, backed by localStorage. */

export const ALL_VIEW = "all";
export const TRASH_VIEW = "trash";

export interface NoteFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Note {
  id: string;
  folderId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface Snapshot {
  version: 2;
  notes: Note[];
  folders: NoteFolder[];
  selectedId: string | null;
  /** "all", "trash", or a folder id. */
  view: string;
}

const STORAGE_KEY = "notes.v1";
const SAVE_DELAY = 250;
const MAX_FOLDER_NAME = 40;

const SEED_BODY = [
  "# Welcome to Notes",
  "",
  "A small, **Markdown**-first notes app that runs entirely in your browser. Everything is saved locally as you type.",
  "",
  "## Try it out",
  "",
  "- Type in the middle pane and the preview keeps up in real time",
  "- Switch themes with **Auto / Light / Dark** in the sidebar",
  "- Press `Alt+N` for a new note, `⌘K` to search",
  "- Create folders with **+** next to *Folders*, then move notes with the folder button above the editor",
  "",
  "> Notes live in `localStorage`, so reloading the page never loses your work.",
  "",
  "### Checklists",
  "",
  "1. Live Markdown preview",
  "2. Dark, light and system themes",
  "3. Write something of your own",
  "",
  "- [x] Ship a single self-contained HTML file",
  "- [x] Keep the source small and dependency-free",
  "- [ ] Take a note",
  "",
  "### Code",
  "",
  "```ts",
  'type Note = { id: string; folderId: string; body: string };',
  "",
  "export function isFresh(note: Note, now = Date.now()): boolean {",
  "  return now - note.updatedAt < 5_000;",
  "}",
  "```",
  "",
  "### Shortcuts",
  "",
  "| Shortcut | Action |",
  "| :-- | :-- |",
  "| `Alt+N` | New note |",
  "| `⌘K` | Search |",
  "| `⌘B` | Bold |",
  "| `⌘I` | Italic |",
  "| `⌘\\` | Toggle preview pane |",
  "| `⌘⇧P` | Full-screen preview |",
  "",
  "---",
  "",
  "That's it. Delete this note whenever you like.",
].join("\n");

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isFolder(value: unknown): value is NoteFolder {
  if (!value || typeof value !== "object") return false;
  const folder = value as Partial<NoteFolder>;
  return typeof folder.id === "string" && typeof folder.name === "string";
}

function isNote(value: unknown): value is Partial<Note> & { id: string; body: string } {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<Note>;
  return typeof note.id === "string" && typeof note.body === "string";
}

function normaliseFolder(folder: NoteFolder): NoteFolder {
  return {
    id: folder.id,
    name: folder.name.trim() || "Untitled Folder",
    createdAt: Number.isFinite(folder.createdAt) ? folder.createdAt : Date.now(),
  };
}

function normaliseNote(note: Partial<Note> & { id: string; body: string }, fallbackFolderId: string): Note {
  const createdAt = Number.isFinite(note.createdAt) ? (note.createdAt as number) : Date.now();
  return {
    id: note.id,
    folderId: typeof note.folderId === "string" ? note.folderId : fallbackFolderId,
    body: note.body,
    createdAt,
    updatedAt: Number.isFinite(note.updatedAt) ? (note.updatedAt as number) : createdAt,
    deletedAt: typeof note.deletedAt === "number" ? note.deletedAt : null,
  };
}

export class NotesStore {
  notes: Note[] = [];
  folders: NoteFolder[] = [];
  selectedId: string | null = null;
  view = ALL_VIEW;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /* ---------------------------------------------------------------- *
   * Loading & migration
   * ---------------------------------------------------------------- */

  private load(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }

    if (raw === null) {
      this.seed();
      return;
    }

    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const folders = Array.isArray(data.folders) ? data.folders.filter(isFolder).map(normaliseFolder) : [];
      const rawNotes = Array.isArray(data.notes) ? data.notes.filter(isNote) : [];

      // v1 snapshots (and stores whose folders were all deleted) get a default folder.
      if (folders.length === 0) {
        folders.push({ id: uid(), name: "Notes", createdAt: Date.now() });
      }

      const fallbackFolderId = folders[0]!.id;
      const notes = rawNotes.map((note) => normaliseNote(note, fallbackFolderId));
      for (const note of notes) {
        if (!folders.some((folder) => folder.id === note.folderId)) note.folderId = fallbackFolderId;
      }

      this.folders = folders;
      this.notes = notes;

      const legacyView = data.folder === TRASH_VIEW ? TRASH_VIEW : ALL_VIEW;
      const storedView = typeof data.view === "string" ? data.view : legacyView;
      this.view = this.isValidView(storedView) ? storedView : ALL_VIEW;

      const selected = typeof data.selectedId === "string" ? data.selectedId : null;
      this.selectedId =
        selected && this.notes.some((note) => note.id === selected && this.inView(note)) ? selected : null;
      this.ensureSelection();
    } catch {
      this.seed();
    }
  }

  private seed(): void {
    const now = Date.now();
    const folder: NoteFolder = { id: uid(), name: "Notes", createdAt: now };
    const note: Note = {
      id: uid(),
      folderId: folder.id,
      body: SEED_BODY,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.folders = [folder];
    this.notes = [note];
    this.selectedId = note.id;
    this.view = ALL_VIEW;
  }

  /* ---------------------------------------------------------------- *
   * Views & queries
   * ---------------------------------------------------------------- */

  isValidView(view: string): boolean {
    return view === ALL_VIEW || view === TRASH_VIEW || this.folders.some((folder) => folder.id === view);
  }

  /** The folder currently being viewed, or null for All Notes / Recently Deleted. */
  currentFolderId(): string | null {
    if (this.view === ALL_VIEW || this.view === TRASH_VIEW) return null;
    return this.view;
  }

  folderName(id: string): string {
    return this.folders.find((folder) => folder.id === id)?.name ?? "Notes";
  }

  inView(note: Note): boolean {
    if (this.view === TRASH_VIEW) return note.deletedAt !== null;
    if (note.deletedAt !== null) return false;
    if (this.view === ALL_VIEW) return true;
    return note.folderId === this.view;
  }

  visible(query = ""): Note[] {
    const needle = query.trim().toLowerCase();

    // With a search term, look across every folder in the current context.
    const searching = needle.length > 0;
    const candidates = this.notes.filter((note) => {
      if (this.view === TRASH_VIEW) return note.deletedAt !== null;
      if (note.deletedAt !== null) return false;
      if (searching || this.view === ALL_VIEW) return true;
      return note.folderId === this.view;
    });

    const filtered = searching ? candidates.filter((note) => note.body.toLowerCase().includes(needle)) : candidates;

    return filtered.sort((a, b) => {
      const aKey = this.view === TRASH_VIEW ? (a.deletedAt ?? 0) : a.updatedAt;
      const bKey = this.view === TRASH_VIEW ? (b.deletedAt ?? 0) : b.updatedAt;
      return bKey - aKey;
    });
  }

  active(): Note | null {
    if (!this.selectedId) return null;
    return this.notes.find((note) => note.id === this.selectedId) ?? null;
  }

  counts(): { notes: number; trash: number } {
    let notes = 0;
    let trash = 0;
    for (const note of this.notes) {
      if (note.deletedAt === null) notes += 1;
      else trash += 1;
    }
    return { notes, trash };
  }

  folderCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const folder of this.folders) counts[folder.id] = 0;
    for (const note of this.notes) {
      if (note.deletedAt !== null) continue;
      counts[note.folderId] = (counts[note.folderId] ?? 0) + 1;
    }
    return counts;
  }

  ensureSelection(): void {
    const visible = this.visible();
    if (this.selectedId && visible.some((note) => note.id === this.selectedId)) return;
    this.selectedId = visible[0]?.id ?? null;
  }

  /* ---------------------------------------------------------------- *
   * Mutations
   * ---------------------------------------------------------------- */

  select(id: string | null): void {
    this.selectedId = id;
    this.ensureSelection();
    this.save();
  }

  setView(view: string): void {
    if (!this.isValidView(view) || this.view === view) return;
    this.view = view;
    this.ensureSelection();
    this.save();
  }

  create(): Note {
    const folderId = this.currentFolderId() ?? this.folders[0]!.id;
    const now = Date.now();
    const note: Note = { id: uid(), folderId, body: "", createdAt: now, updatedAt: now, deletedAt: null };

    this.notes.push(note);
    this.selectedId = note.id;
    if (this.view === TRASH_VIEW) this.view = folderId;
    this.save();
    return note;
  }

  updateBody(id: string, body: string): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (!note || note.body === body) return;
    note.body = body;
    note.updatedAt = Date.now();
    this.save();
  }

  trash(id: string): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (!note || note.deletedAt !== null) return;
    note.deletedAt = Date.now();
    this.ensureSelection();
    this.save();
  }

  restore(id: string): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (!note) return;

    note.deletedAt = null;
    note.updatedAt = Date.now();
    this.view = this.folders.some((folder) => folder.id === note.folderId) ? note.folderId : this.folders[0]!.id;
    this.selectedId = note.id;
    this.save();
  }

  destroy(id: string): void {
    this.notes = this.notes.filter((note) => note.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.ensureSelection();
    this.save();
  }

  emptyTrash(): void {
    this.notes = this.notes.filter((note) => note.deletedAt === null);
    this.ensureSelection();
    this.save();
  }

  /* ---------------------------------------------------------------- *
   * Folders
   * ---------------------------------------------------------------- */

  private uniqueFolderName(name: string, ignoreId?: string): string {
    const base = name.trim().slice(0, MAX_FOLDER_NAME) || "New Folder";
    let candidate = base;
    let suffix = 2;
    while (this.folders.some((folder) => folder.id !== ignoreId && folder.name === candidate)) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  createFolder(name: string): NoteFolder {
    const folder: NoteFolder = {
      id: uid(),
      name: this.uniqueFolderName(name),
      createdAt: Date.now(),
    };

    this.folders.push(folder);
    this.view = folder.id;
    this.selectedId = null;
    this.ensureSelection();
    this.save();
    return folder;
  }

  renameFolder(id: string, name: string): void {
    const folder = this.folders.find((candidate) => candidate.id === id);
    if (!folder) return;

    const trimmed = name.trim().slice(0, MAX_FOLDER_NAME);
    if (!trimmed || trimmed === folder.name) return;

    folder.name = this.uniqueFolderName(trimmed, id);
    this.save();
  }

  /** Deletes a folder and moves any notes it contains to Recently Deleted. */
  deleteFolder(id: string): void {
    if (!this.folders.some((folder) => folder.id === id)) return;

    const now = Date.now();
    for (const note of this.notes) {
      if (note.folderId === id && note.deletedAt === null) note.deletedAt = now;
    }

    this.folders = this.folders.filter((folder) => folder.id !== id);
    if (this.folders.length === 0) {
      this.folders.push({ id: uid(), name: "Notes", createdAt: now });
    }

    if (this.view === id) this.view = ALL_VIEW;
    this.ensureSelection();
    this.save();
  }

  moveNote(id: string, folderId: string): void {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (!note || note.folderId === folderId) return;
    if (!this.folders.some((folder) => folder.id === folderId)) return;

    note.folderId = folderId;
    note.updatedAt = Date.now();
    this.view = folderId;
    this.selectedId = note.id;
    this.save();
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  private snapshot(): string {
    const data: Snapshot = {
      version: 2,
      notes: this.notes,
      folders: this.folders,
      selectedId: this.selectedId,
      view: this.view,
    };
    return JSON.stringify(data);
  }

  save(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DELAY);
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, this.snapshot());
    } catch {
      // Storage can be full or blocked (private mode); the app keeps working in memory.
    }
  }
}
