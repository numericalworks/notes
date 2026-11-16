#!/usr/bin/env bun
/**
 * Bundles the app into one self-contained file: dist/index.html
 *
 *   bun build.ts               # minified single file
 *   bun build.ts --dev         # unminified, easier to read
 *   bun build.ts --no-mermaid  # skip the 5 MB Mermaid bundle (small output)
 *   bun build.ts --serve       # dev server that rebuilds on reload
 */

import { mkdirSync } from "node:fs";

const ROOT = import.meta.dir;
const args = new Set(Bun.argv.slice(2));
const DEV = args.has("--dev");
const SERVE = args.has("--serve");
const WITHOUT_MERMAID = args.has("--no-mermaid");
const PORT = Number(process.env.PORT ?? 4173);
const OUT_DIR = `${ROOT}/dist`;
const OUT_FILE = `${OUT_DIR}/index.html`;
const MERMAID_FILE = `${ROOT}/node_modules/mermaid/dist/mermaid.min.js`;
const CHARTJS_FILE = `${ROOT}/node_modules/chart.js/dist/chart.umd.js`;
const FAVICON_FILE = `${ROOT}/src/favicon.svg`;

function escapeClosingTag(code: string, tag: string): string {
  return code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

async function mermaidBundle(): Promise<string> {
  if (WITHOUT_MERMAID) return "";

  if (!(await Bun.file(MERMAID_FILE).exists())) {
    console.warn("! Mermaid bundle not found — run `bun install`; diagrams will report an error");
    return "";
  }

  // The official UMD build is stable in browsers; bundling Mermaid's ESM build
  // with Bun produces a bundle that hangs during startup.
  return escapeClosingTag(await Bun.file(MERMAID_FILE).text(), "script");
}

async function chartJsBundle(): Promise<string> {
  if (!(await Bun.file(CHARTJS_FILE).exists())) {
    console.warn("! Chart.js bundle not found — run `bun install`; chart blocks will report an error");
    return "";
  }
  return escapeClosingTag(await Bun.file(CHARTJS_FILE).text(), "script");
}

async function bundle(mermaid: string, chartjs: string): Promise<string> {
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

  // Inline the favicon so the build stays a single, self-contained file.
  const faviconSvg = (await Bun.file(FAVICON_FILE).text()).trim();
  const favicon = `data:image/svg+xml,${encodeURIComponent(faviconSvg).replace(/'/g, "%27")}`;

  for (const placeholder of ["/*__CSS__*/", "/*__MERMAID__*/", "/*__CHARTJS__*/", "/*__JS__*/", "__BUILD__", "__FAVICON__"]) {
    if (!template.includes(placeholder)) {
      throw new Error(`src/index.html is missing the ${placeholder} placeholder`);
    }
  }

  const buildId = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}${
    WITHOUT_MERMAID ? "-no-mermaid" : ""
  }`;

  return template
    .replace("__BUILD__", () => buildId)
    .replace("__FAVICON__", () => favicon)
    .replace("/*__CSS__*/", () => css)
    .replace("/*__MERMAID__*/", () => mermaid)
    .replace("/*__CHARTJS__*/", () => chartjs)
    .replace("/*__JS__*/", () => js);
}

async function buildAndWrite(): Promise<string> {
  const html = await bundle(await mermaidBundle(), await chartJsBundle());
  mkdirSync(OUT_DIR, { recursive: true });
  await Bun.write(OUT_FILE, html);

  const kilobytes = (new TextEncoder().encode(html).length / 1024).toFixed(1);
  console.log(
    `dist/index.html  ${kilobytes} kB  (${DEV ? "dev" : "minified"}, ${
      WITHOUT_MERMAID ? "no Mermaid" : "with Mermaid"
    }, self-contained)`,
  );
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
