# Notes

An Apple Notes–inspired, Markdown-first notes app. Type in the middle pane and the
rendered note updates in the right pane as you go. Everything is stored locally, and
the whole app compiles down to **one self-contained `index.html`** — no CDN, no fonts
to fetch, no server.

![Light theme](docs/screenshot-light.png)

## Quick start

```sh
bun install
bun run build      # writes dist/index.html
```

Open `dist/index.html` directly in a browser — that single file is the entire app.

For development:

```sh
bun run dev        # http://localhost:4173, rebuilds on every reload
bun run build --dev # unminified build, easier to read
bun test           # Markdown + store unit tests
bun run typecheck  # tsc --noEmit
```

## Features

- **Four panes, one window** — folders sidebar, notes list, Markdown source, live preview.
- **Folders** — create, rename, delete and move notes between them; deleting a folder
  sends its notes to Recently Deleted rather than destroying them.
- **Preview on your terms** — hide the preview pane when you only want to write
  (`⌘\`, remembered across reloads), or expand it into a distraction-free full-screen
  reader (`⌘⇧P`, `Esc` to exit).
- **Live preview** rendered on every keystroke, with proportional scroll sync from the
  editor to the preview.
- **Themes** — Auto (follows the OS via `prefers-color-scheme`), Light, Dark. The theme
  is applied before first paint, so there is no flash of the wrong colours.
- **Local-first storage** — notes are persisted to `localStorage` with a debounced
  write, plus a flush on tab close/hide.
- **Recently Deleted** — soft delete, restore, delete forever, empty trash.
- **Search** across all note text, plus a formatting toolbar, list auto-continuation,
  word count, and Markdown file export. Searching looks across every folder, while
  browsing stays inside the folder you picked.
- **Responsive** — at narrower widths the folders become a drawer, and on phones the
  editor and preview become Edit/Preview tabs.
- **No runtime dependencies** — the Markdown renderer, highlighter and UI are all in
  `src/`, so the bundle stays tiny (~64 kB).

<p align="center">
  <img src="docs/screenshot-dark.png" alt="Dark theme" width="49%" />
  <img src="docs/screenshot-mobile.png" alt="Mobile preview" width="24%" />
</p>

<p align="center">
  <img src="docs/screenshot-focus.png" alt="Full-screen preview" width="80%" />
</p>

## Folder basics

- **Create** — click `+` next to *Folders* or the **New Folder** row, type a name, press `Enter`.
- **Rename / delete** — hover a folder row for its pencil and trash buttons. Deleting asks for
  confirmation and moves that folder's notes to Recently Deleted.
- **Move a note** — open the folder button above the editor and pick a destination. The note
  moves there and the app switches to that folder.
- **All Notes** is a smart view across every folder; **Recently Deleted** is the trash.
- New notes are created in the folder you are currently viewing (or the first folder from
  *All Notes*). Folders are flat — there is no nesting.
- **Empty folders** — opening one gives you a blank editor. Just start typing: the note is
  created in that folder, no button press needed.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+N` | New note |
| `⌘K` / `Ctrl+K` | Focus search |
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘\` / `Ctrl+\` | Show / hide the preview pane |
| `⌘⇧P` / `Ctrl+Shift+P` | Full-screen preview |
| `Tab` | Indent by two spaces |
| `Enter` | Continue the current list (empty item exits the list) |
| `Esc` | Exit full-screen preview, clear search, close popovers and drawers |

## Markdown support

Headings (ATX and setext), bold/italic/strikethrough, inline code, fenced code blocks
with lightweight highlighting for JS/TS, JSON, CSS, HTML, Python, shell, SQL, Go, Rust,
Java and more, links, images, autolinks, bare URLs, blockquotes, nested ordered and
bullet lists, task lists, tables with alignment, and horizontal rules.

Deliberate choices:

- **Raw HTML is escaped**, never injected — a note can't execute scripts.
- **Single newlines become line breaks**, which is what you expect when writing notes.
- Checkboxes in the preview are read-only; edit the `[x]` / `[ ]` in the source.

## How it is built

```mermaid
flowchart LR
  A[src/index.html<br/>shell] --> D[build.ts]
  B[src/styles.css] --> D
  C[src/main.ts<br/>Bun.build] --> D
  D --> E[dist/index.html<br/>inline JS + CSS]
```

```mermaid
flowchart TD
  M[main.ts<br/>view controller] --> S[store.ts<br/>localStorage notes]
  M --> K[markdown.ts<br/>renderer + highlighter]
  M --> T[theme.ts<br/>system / light / dark]
```

`build.ts` bundles `src/main.ts` with `Bun.build`, then substitutes the resulting
JavaScript and `src/styles.css` into the `/*__CSS__*/` and `/*__JS__*/` placeholders in
`src/index.html`. Closing `</script>` sequences are escaped so the inline bundle can
never terminate its own tag.

```
src/
  index.html   layout + inline theme bootstrap
  styles.css   design tokens (light/dark) + all UI styles
  main.ts      editor, list, folders, preview modes, search, trash, shortcuts
  markdown.ts  dependency-free Markdown renderer with highlighting
  store.ts     notes + folders, ordering, migration, debounced persistence
  theme.ts     theme mode resolution and system sync
tests/
  markdown.test.ts
  store.test.ts
```

## Notes and limitations

- Storage is per browser profile and per origin. Opening `dist/index.html` from disk
  (`file://`) and from a local server are different origins, so they keep separate notes.
  Snapshots from earlier versions (before folders existed) are migrated automatically into
  a default “Notes” folder.
- No sync, accounts, or encryption — notes live unencrypted in `localStorage`.
- Undo history is whatever the browser keeps for the textarea; toolbar actions that
  rewrite the buffer may not be undoable.
