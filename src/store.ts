/** Note persistence and ordering, backed by localStorage. */

export type Folder = "notes" | "trash";

export interface Note {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface Snapshot {
  notes: Note[];
  selectedId: string | null;
  folder: Folder;
}

const STORAGE_KEY = "notes.v1";
const SAVE_DELAY = 250;

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
  "- Use the formatting bar, or just write Markdown",
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
  'type Note = { id: string; body: string; updatedAt: number };',
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
  "",
  "---",
  "",
  "That's it. Delete this note whenever you like.",
].join("\n");

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<Note>;
  return typeof note.id === "string" && typeof note.body === "string";
}

function normalise(note: Note): Note {
  const createdAt = Number.isFinite(note.createdAt) ? note.createdAt : Date.now();
  return {
    id: note.id,
    body: note.body,
    createdAt,
    updatedAt: Number.isFinite(note.updatedAt) ? note.updatedAt : createdAt,
    deletedAt: typeof note.deletedAt === "number" ? note.deletedAt : null,
  };
}

function createSeedNote(): Note {
  const now = Date.now();
  return { id: uid(), body: SEED_BODY, createdAt: now, updatedAt: now, deletedAt: null };
}

export class NotesStore {
  notes: Note[] = [];
  selectedId: string | null = null;
  folder: Folder = "notes";

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

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
      const data = JSON.parse(raw) as Partial<Snapshot>;
      const notes = Array.isArray(data.notes) ? data.notes.filter(isNote).map(normalise) : [];
      this.notes = notes;
      this.folder = data.folder === "trash" ? "trash" : "notes";
      const selected = typeof data.selectedId === "string" ? data.selectedId : null;
      this.selectedId = this.notes.some((note) => note.id === selected && this.inFolder(note)) ? selected : null;
      this.ensureSelection();
    } catch {
      this.seed();
    }
  }

  private seed(): void {
    const note = createSeedNote();
    this.notes = [note];
    this.selectedId = note.id;
    this.folder = "notes";
  }

  inFolder(note: Note): boolean {
    return this.folder === "trash" ? note.deletedAt !== null : note.deletedAt === null;
  }

  visible(query = ""): Note[] {
    const needle = query.trim().toLowerCase();
    const inFolder = this.notes.filter((note) => this.inFolder(note));
    const filtered = needle ? inFolder.filter((note) => note.body.toLowerCase().includes(needle)) : inFolder;

    return filtered.sort((a, b) => {
      const aKey = this.folder === "trash" ? (a.deletedAt ?? 0) : a.updatedAt;
      const bKey = this.folder === "trash" ? (b.deletedAt ?? 0) : b.updatedAt;
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

  ensureSelection(): void {
    const visible = this.visible();
    if (this.selectedId && visible.some((note) => note.id === this.selectedId)) return;
    this.selectedId = visible[0]?.id ?? null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.ensureSelection();
    this.save();
  }

  setFolder(folder: Folder): void {
    if (this.folder === folder) return;
    this.folder = folder;
    this.ensureSelection();
    this.save();
  }

  create(): Note {
    const now = Date.now();
    const note: Note = { id: uid(), body: "", createdAt: now, updatedAt: now, deletedAt: null };
    this.notes.push(note);
    this.folder = "notes";
    this.selectedId = note.id;
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
    this.folder = "notes";
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

  private snapshot(): string {
    const data: Snapshot = { notes: this.notes, selectedId: this.selectedId, folder: this.folder };
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
