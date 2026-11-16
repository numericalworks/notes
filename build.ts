#!/usr/bin/env bun
/**
 * Bundles the app into one self-contained file: dist/index.html
 *
 *   bun build.ts          # minified single file
 *   bun build.ts --dev    # unminified, easier to read
 *   bun build.ts --serve  # dev server that rebuilds on reload
 */

import { mkdirSync } from "node:fs";

const ROOT = import.meta.dir;
const args = new Set(Bun.argv.slice(2));
const DEV = args.has("--dev");
const SERVE = args.has("--serve");
const PORT = Number(process.env.PORT ?? 4173);
const OUT_DIR = `${ROOT}/dist`;
const OUT_FILE = `${OUT_DIR}/index.html`;

function escapeClosingTag(code: string, tag: string): string {
  return code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

async function bundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [`${ROOT}/src/main.ts`],
    target: "browser",
    format: "esm",
    minify: !DEV,
    splitting: false,
    sourcemap: "none",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Bundling failed");
  }

  const script = result.outputs.find((output) => output.path.endsWith(".js"));
  if (!script) throw new Error("Bundler produced no JavaScript output");

  const js = escapeClosingTag(await script.text(), "script");
  const css = escapeClosingTag(await Bun.file(`${ROOT}/src/styles.css`).text(), "style");
  const template = await Bun.file(`${ROOT}/src/index.html`).text();

  if (!template.includes("/*__CSS__*/") || !template.includes("/*__JS__*/")) {
    throw new Error("src/index.html is missing the /*__CSS__*/ or /*__JS__*/ placeholder");
  }

  return template.replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => js);
}

async function buildAndWrite(): Promise<string> {
  const html = await bundle();
  mkdirSync(OUT_DIR, { recursive: true });
  await Bun.write(OUT_FILE, html);
  const kilobytes = (new TextEncoder().encode(html).length / 1024).toFixed(1);
  console.log(`dist/index.html  ${kilobytes} kB  (${DEV ? "dev" : "minified"}, self-contained)`);
  return html;
}

if (SERVE) {
  await buildAndWrite();
  const server = Bun.serve({
    port: PORT,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname !== "/" && pathname !== "/index.html") {
        return new Response("Not found", { status: 404 });
      }
      try {
        const html = await buildAndWrite();
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      } catch (error) {
        return new Response(`<pre style="font:13px/1.5 monospace;padding:20px">${String(error)}</pre>`, {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    },
  });
  console.log(`Serving on http://localhost:${server.port} — reload to rebuild`);
} else {
  await buildAndWrite();
}
