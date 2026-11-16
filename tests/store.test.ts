import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ALL_VIEW, NotesStore, TRASH_VIEW } from "../src/store";

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  get length(): number {
    return this.data.size;
  }
}

const storage = new MemoryStorage();
const created: NotesStore[] = [];

function freshStore(): NotesStore {
  const store = new NotesStore();
  created.push(store);
  return store;
}

beforeEach(() => {
  storage.clear();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
});

afterEach(() => {
  for (const store of created.splice(0)) store.flush();
});

describe("seeding", () => {
  test("starts with a default folder and the welcome note", () => {
    const store = freshStore();
    expect(store.folders).toHaveLength(1);
    expect(store.folders[0]!.name).toBe("Notes");
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0]!.folderId).toBe(store.folders[0]!.id);
    expect(store.view).toBe(ALL_VIEW);
  });
});

describe("folders", () => {
  test("new notes land in the folder being viewed", () => {
    const store = freshStore();
    const work = store.createFolder("Work");

    expect(store.view).toBe(work.id);
    expect(store.visible()).toHaveLength(0);

    const note = store.create();
    expect(note.folderId).toBe(work.id);
    expect(store.visible().map((item) => item.id)).toEqual([note.id]);

    store.setView(ALL_VIEW);
    expect(store.visible()).toHaveLength(2);
  });

  test("folder names are unique and renameable", () => {
    const store = freshStore();
    const first = store.createFolder("Work");
    const second = store.createFolder("Work");

    expect(second.name).toBe("Work 2");

    store.renameFolder(second.id, "Work");
    expect(store.folderName(second.id)).toBe("Work 2");

    store.renameFolder(first.id, "Projects");
    expect(store.folderName(first.id)).toBe("Projects");
  });

  test("moving a note switches to the destination folder", () => {
    const store = freshStore();
    const personal = store.createFolder("Personal");
    store.setView(ALL_VIEW);
    const note = store.active()!;

    store.moveNote(note.id, personal.id);

    expect(store.view).toBe(personal.id);
    expect(store.active()!.folderId).toBe(personal.id);
    expect(store.visible()).toHaveLength(1);
    expect(store.folderCounts()[personal.id]).toBe(1);
  });

  test("deleting a folder moves its notes to Recently Deleted", () => {
    const store = freshStore();
    const work = store.createFolder("Work");
    const note = store.create();

    store.deleteFolder(work.id);

    expect(store.folders.some((folder) => folder.id === work.id)).toBe(false);
    expect(store.view).toBe(ALL_VIEW);
    expect(store.notes.find((item) => item.id === note.id)!.deletedAt).not.toBeNull();
    expect(store.counts().trash).toBe(1);
  });

  test("deleting the last folder creates a fresh default folder", () => {
    const store = freshStore();
    const original = store.folders[0]!.id;

    store.deleteFolder(original);

    expect(store.folders).toHaveLength(1);
    expect(store.folders[0]!.id).not.toBe(original);
  });

  test("restoring a note returns to the folder it came from", () => {
    const store = freshStore();
    const work = store.createFolder("Work");
    const note = store.create();

    store.trash(note.id);
    expect(store.counts().trash).toBe(1);

    store.setView(TRASH_VIEW);
    store.restore(note.id);

    expect(store.view).toBe(work.id);
    expect(store.active()!.id).toBe(note.id);
    expect(store.folderCounts()[work.id]).toBe(1);
  });

  test("searching spans folders, browsing does not", () => {
    const store = freshStore();
    const work = store.createFolder("Work");
    const note = store.create();
    store.updateBody(note.id, "# Meeting notes");

    const personal = store.createFolder("Personal");
    expect(store.view).toBe(personal.id);
    expect(store.visible()).toHaveLength(0);
    expect(store.visible("meeting")).toHaveLength(1);
    expect(store.visible("meeting")[0]!.folderId).toBe(work.id);
  });

  test("unknown views are ignored", () => {
    const store = freshStore();
    store.setView("does-not-exist");
    expect(store.view).toBe(ALL_VIEW);
  });
});

describe("welcome note upgrades", () => {
  const signature = "That's it. Delete this note whenever you like.";
  const oldBody = [
    "# Welcome to Notes",
    "",
    "An older demo note.",
    "",
    "### Shortcuts",
    "",
    "| Shortcut | Action |",
    "| :-- | :-- |",
    "| `Alt+N` | New note |",
    "",
    "---",
    "",
    signature,
  ].join("\n");

  function loadStore(body: string): NotesStore {
    storage.setItem(
      "notes.v1",
      JSON.stringify({
        version: 2,
        folders: [{ id: "f1", name: "Notes", createdAt: 1 }],
        notes: [{ id: "n1", folderId: "f1", body, createdAt: 1, updatedAt: 1, deletedAt: null }],
        selectedId: "n1",
        view: "all",
      }),
    );
    return freshStore();
  }

  test("adds the charts example to an older demo note", () => {
    const store = loadStore(oldBody);
    const body = store.notes[0]!.body;

    expect(body).toContain("### Charts");
    expect(body).toContain("```chart");
    expect(body).toContain('"type": "bar"');
    expect(body.indexOf("### Charts")).toBeLessThan(body.indexOf("### Shortcuts"));
    expect(body.endsWith(signature)).toBe(true);
  });

  test("does not touch notes the user rewrote", () => {
    const custom = "# Welcome to Notes\n\nI replaced this with my own text.";
    const store = loadStore(custom);
    expect(store.notes[0]!.body).toBe(custom);
  });

  test("is idempotent", () => {
    const once = loadStore(oldBody).notes[0]!.body;
    const twice = loadStore(once).notes[0]!.body;
    expect(twice).toBe(once);
    expect(twice.match(/### Charts/g)?.length).toBe(1);
  });
});

describe("persistence", () => {
  test("folders, notes and the current view survive a reload", () => {
    const store = freshStore();
    const archive = store.createFolder("Archive");
    const note = store.create();
    store.updateBody(note.id, "# Archived thought");
    store.flush();

    const reloaded = freshStore();
    expect(reloaded.folders.map((folder) => folder.name)).toContain("Archive");
    expect(reloaded.view).toBe(archive.id);
    expect(reloaded.active()!.body).toContain("Archived thought");
  });

  test("v1 snapshots are migrated into a default folder", () => {
    storage.setItem(
      "notes.v1",
      JSON.stringify({
        notes: [{ id: "old", body: "# Legacy note", createdAt: 1, updatedAt: 2, deletedAt: null }],
        selectedId: "old",
        folder: "notes",
      }),
    );

    const store = freshStore();

    expect(store.folders).toHaveLength(1);
    expect(store.folders[0]!.name).toBe("Notes");
    expect(store.notes[0]!.folderId).toBe(store.folders[0]!.id);
    expect(store.selectedId).toBe("old");
    expect(store.view).toBe(ALL_VIEW);
    expect(store.visible()).toHaveLength(1);
  });

  test("snapshots referencing a missing folder are repaired", () => {
    storage.setItem(
      "notes.v1",
      JSON.stringify({
        version: 2,
        folders: [{ id: "kept", name: "Kept", createdAt: 1 }],
        notes: [
          { id: "a", folderId: "gone", body: "# A", createdAt: 1, updatedAt: 1, deletedAt: null },
          { id: "b", body: "# B", createdAt: 1, updatedAt: 1, deletedAt: null },
        ],
        selectedId: "a",
        view: "gone",
      }),
    );

    const store = freshStore();

    expect(store.notes.every((note) => note.folderId === "kept")).toBe(true);
    expect(store.view).toBe(ALL_VIEW);
    expect(store.visible()).toHaveLength(2);
  });
});
