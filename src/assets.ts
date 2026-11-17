/**
 * Inline vendor bundles.
 *
 * `build.ts` embeds large vendor scripts as gzip+base64 payloads in inert
 * `<script type="application/gzip;base64">` tags. This module inflates and
 * starts one on demand, caching the promise so repeated calls share the work.
 *
 * The payload is started from a blob URL, which keeps normal `<script>`
 * semantics (UMD builds assign their global) without resorting to `eval`.
 */

const loading = new Map<string, Promise<void>>();

/** The base64 payload for `id`, or `null` when the build omitted that bundle. */
function payload(id: string): string | null {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLScriptElement)) return null;
  const base64 = element.textContent?.replace(/\s+/g, "") ?? "";
  return base64.length > 0 ? base64 : null;
}

/**
 * The payload tags live after the app script (so the browser parses the UI first),
 * which means a preload started during the app script's first render cannot see
 * them yet. Wait for the parser to finish before looking one up.
 */
function whenParsed(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });
}

async function inflate(base64: string): Promise<string> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot decompress the bundled scripts (DecompressionStream is unavailable).");
  }

  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function start(code: string, id: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not start the bundled ${id} script`));
      document.head.appendChild(script);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resolves once the bundle has run, or immediately when it was not included. */
export function loadInlineBundle(id: string): Promise<void> {
  const pending = loading.get(id);
  if (pending) return pending;

  const task = (async () => {
    await whenParsed();
    const encoded = payload(id);
    if (encoded === null) return;
    await start(await inflate(encoded), id);
  })().catch((error: unknown) => {
    loading.delete(id);
    throw error;
  });
  loading.set(id, task);
  return task;
}
