/**
 * A small, dependency-free Markdown renderer tuned for a notes app.
 *
 * Supported: ATX + setext headings, bold/italic/strikethrough, inline code,
 * fenced code blocks with lightweight syntax highlighting, links, images,
 * autolinks, nested (ordered/unordered/task) lists, blockquotes, tables,
 * horizontal rules and hard line breaks.
 *
 * All HTML is escaped, so raw HTML in a note is displayed literally instead of
 * being injected into the page.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Pluggable math renderer (installed by the app; kept out of the parser so it stays DOM-free). */
export interface MathRenderer {
  render(source: string, display: boolean): string | null;
}

let mathRenderer: MathRenderer | null = null;

export function setMathRenderer(renderer: MathRenderer | null): void {
  mathRenderer = renderer;
}

/* ------------------------------------------------------------------ *
 * Syntax highlighting
 * ------------------------------------------------------------------ */

interface CodeLanguage {
  keywords: string[];
  /** Markers that start a single line comment, e.g. ["//"]. */
  line: string[];
  /** Whether slash-star block comments are supported. */
  block?: boolean;
  /** Quotation characters that delimit strings. */
  quotes?: string[];
  /** Tags, attributes and friends instead of programming tokens. */
  kind?: "markup";
}

const JS_KEYWORDS =
  "async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined".split(
    " ",
  );

const TS_KEYWORDS = [
  ...JS_KEYWORDS,
  "any boolean never number object readonly string symbol unknown",
  "interface type enum implements namespace declare abstract as satisfies keyof",
  "public private protected infer is asserts override",
]
  .join(" ")
  .split(" ");

const PY_KEYWORDS =
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(
    " ",
  );

const SHELL_KEYWORDS = "if then else elif fi for while do done case esac function return export local echo".split(" ");

const SQL_KEYWORDS =
  "select from where insert into values update set delete create table alter drop join left right inner outer on group by order having limit offset as and or not null primary key foreign references index distinct union all case when then else end".split(
    " ",
  );

const LANGS: Record<string, CodeLanguage> = {
  js: { keywords: JS_KEYWORDS, line: ["//"], block: true },
  jsx: { keywords: JS_KEYWORDS, line: ["//"], block: true },
  javascript: { keywords: JS_KEYWORDS, line: ["//"], block: true },
  mjs: { keywords: JS_KEYWORDS, line: ["//"], block: true },
  ts: { keywords: TS_KEYWORDS, line: ["//"], block: true },
  tsx: { keywords: TS_KEYWORDS, line: ["//"], block: true },
  typescript: { keywords: TS_KEYWORDS, line: ["//"], block: true },
  json: { keywords: ["true", "false", "null"], line: [] },
  css: { keywords: [], line: [], block: true },
  scss: { keywords: [], line: ["//"], block: true },
  py: { keywords: PY_KEYWORDS, line: ["#"] },
  python: { keywords: PY_KEYWORDS, line: ["#"] },
  sh: { keywords: SHELL_KEYWORDS, line: ["#"] },
  bash: { keywords: SHELL_KEYWORDS, line: ["#"] },
  zsh: { keywords: SHELL_KEYWORDS, line: ["#"] },
  yaml: { keywords: ["true", "false", "null"], line: ["#"] },
  yml: { keywords: ["true", "false", "null"], line: ["#"] },
  toml: { keywords: ["true", "false"], line: ["#"] },
  sql: { keywords: SQL_KEYWORDS, line: ["--"], block: true },
  go: {
    keywords:
      "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil".split(
        " ",
      ),
    line: ["//"],
    block: true,
  },
  rust: {
    keywords:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while".split(
        " ",
      ),
    line: ["//"],
    block: true,
  },
  java: {
    keywords:
      "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch synchronized this throw throws try void volatile while true false".split(
        " ",
      ),
    line: ["//"],
    block: true,
  },
  html: { keywords: [], line: [], kind: "markup" },
  xml: { keywords: [], line: [], kind: "markup" },
  svg: { keywords: [], line: [], kind: "markup" },
};

function token(className: string, text: string): string {
  return `<span class="tok-${className}">${escapeHtml(text)}</span>`;
}

function highlightTag(tag: string): string {
  const match = /^(<\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?>)$/.exec(tag);
  if (!match) return token("tag", tag);

  const open = match[1]!;
  const name = match[2]!;
  const attrs = match[3]!;
  const close = match[4]!;

  let out = escapeHtml(open) + token("tag", name);
  let i = 0;

  while (i < attrs.length) {
    const ch = attrs[i]!;
    if (/\s/.test(ch) || ch === "/") {
      out += escapeHtml(ch);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = attrs.indexOf(ch, i + 1);
      const stop = end === -1 ? attrs.length : end + 1;
      out += token("string", attrs.slice(i, stop));
      i = stop;
      continue;
    }
    const word = /^[^\s=/"'<>]+/.exec(attrs.slice(i));
    if (word) {
      out += token("attr", word[0]);
      i += word[0].length;
      continue;
    }
    out += escapeHtml(ch);
    i += 1;
  }

  return out + escapeHtml(close);
}

function highlightMarkup(code: string): string {
  let out = "";
  let i = 0;

  while (i < code.length) {
    if (code.startsWith("<!--", i)) {
      const end = code.indexOf("-->", i + 4);
      const stop = end === -1 ? code.length : end + 3;
      out += token("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (code[i] === "<" && /[A-Za-z!?/]/.test(code[i + 1] ?? "")) {
      const end = code.indexOf(">", i);
      const stop = end === -1 ? code.length : end + 1;
      out += highlightTag(code.slice(i, stop));
      i = stop;
      continue;
    }
    const next = code.indexOf("<", i + 1);
    const stop = next === -1 ? code.length : next;
    out += escapeHtml(code.slice(i, stop));
    i = stop;
  }

  return out;
}

export function highlightCode(code: string, language: string): string {
  const config = LANGS[language.toLowerCase()];
  if (!config) return escapeHtml(code);
  if (config.kind === "markup") return highlightMarkup(code);

  const quotes = config.quotes ?? ['"', "'", "`"];
  const keywords = new Set(config.keywords);
  let out = "";
  let i = 0;

  while (i < code.length) {
    if (config.block && code.startsWith("/*", i)) {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += token("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    let commentEnd = -1;
    for (const marker of config.line) {
      if (code.startsWith(marker, i)) {
        commentEnd = code.indexOf("\n", i);
        if (commentEnd === -1) commentEnd = code.length;
        break;
      }
    }
    if (commentEnd !== -1) {
      out += token("comment", code.slice(i, commentEnd));
      i = commentEnd;
      continue;
    }

    const ch = code[i]!;

    if (quotes.includes(ch)) {
      const multiline = ch === "`";
      let j = i + 1;
      while (j < code.length) {
        const current = code[j]!;
        if (current === "\\") {
          j += 2;
          continue;
        }
        if (current === ch) {
          j += 1;
          break;
        }
        if (current === "\n" && !multiline) break;
        j += 1;
      }
      out += token("string", code.slice(i, j));
      i = j;
      continue;
    }

    const previous = i > 0 ? code[i - 1]! : "";
    if (/[0-9]/.test(ch) && !/[\w$]/.test(previous)) {
      const number = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/.exec(code.slice(i));
      if (number) {
        out += token("number", number[0]);
        i += number[0].length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))![0];
      const isCall = /^\s*\(/.test(code.slice(i + word.length));
      if (keywords.has(word)) out += token("keyword", word);
      else if (isCall) out += token("fn", word);
      else if (word === "true" || word === "false" || word === "null" || word === "undefined") out += token("number", word);
      else out += escapeHtml(word);
      i += word.length;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Inline rendering
 * ------------------------------------------------------------------ */

const SENTINEL = "\u0000";

function trimUrl(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = "";
  while (/[.,;:!?]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  while (href.endsWith(")") && (href.match(/\(/g)?.length ?? 0) < (href.match(/\)/g)?.length ?? 0)) {
    trailing = ")" + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

function linkHtml(href: string, label: string, title?: string): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/** Renders inline Markdown (the inside of a paragraph, heading, table cell, ...). */
export function renderInline(raw: string): string {
  if (!raw) return "";

  const stash: string[] = [];
  const keep = (html: string): string => `${SENTINEL}${stash.push(html) - 1}${SENTINEL}`;

  let text = raw;

  // Backslash escapes win over every other inline rule.
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~>|$])/g, (_match, ch: string) => keep(escapeHtml(ch)));

  // Code spans.
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _ticks: string, code: string) => {
    const trimmed = code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code;
    return keep(`<code class="md-inline-code">${escapeHtml(trimmed)}</code>`);
  });

  // Images before links, since they share the bracket syntax.
  text = text.replace(
    /!\[([^\]]*)\]\(\s*([^\s)]+?)(?:\s+["']([^"']*)["'])?\s*\)/g,
    (_match, alt: string, src: string, title?: string) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return keep(
        `<img class="md-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`,
      );
    },
  );

  text = text.replace(
    /\[([^\]]+)\]\(\s*([^\s)]+?)(?:\s+["']([^"']*)["'])?\s*\)/g,
    (_match, label: string, href: string, title?: string) => keep(linkHtml(href, renderInline(label), title)),
  );

  // <https://example.com> style autolinks.
  text = text.replace(/<((?:https?:\/\/|mailto:)[^\s>]+)>/g, (_match, href: string) =>
    keep(linkHtml(href, escapeHtml(href.replace(/^mailto:/, "")))),
  );

  // Bare URLs.
  text = text.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"'`]+)/g, (_match, prefix: string, url: string) => {
    const { href, trailing } = trimUrl(url);
    const target = href.startsWith("www.") ? `https://${href}` : href;
    return `${prefix}${keep(linkHtml(target, escapeHtml(href)))}${trailing}`;
  });

  // AsciiMath: $inline$ (escapes were stashed above, so \$ stays literal).
  const math = mathRenderer;
  if (math) {
    text = text.replace(
      /(?<!\$)\$(?!\$)([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$(?!\d)/g,
      (match, expression: string) => {
        const html = math.render(expression, false);
        // Stash the markup so it is not escaped with the surrounding text.
        return html === null ? match : keep(html);
      },
    );
  }

  // Everything left over is plain text.
  text = escapeHtml(text);

  const emphasise = (line: string): string =>
    line
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "<em><strong>$1</strong></em>")
      .replace(/___(?=\S)([\s\S]*?\S)___/g, "<em><strong>$1</strong></em>")
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?![\w])/g, "$1<strong>$2</strong>")
      .replace(/\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?![\w])/g, "$1<em>$2</em>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");

  text = text
    .split("\n")
    .map(emphasise)
    .join("<br>");

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => stash[Number(index)] ?? "");
}

/* ------------------------------------------------------------------ *
 * Block rendering
 * ------------------------------------------------------------------ */

const FENCE_RE = /^(\s*)(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const UL_RE = /^(\s*)([-*+])([ \t]+)(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})([.)])([ \t]+)(.*)$/;

interface Marker {
  indent: number;
  contentIndent: number;
  ordered: boolean;
  start: number;
  content: string;
}

function expandedIndent(whitespace: string): number {
  let width = 0;
  for (const ch of whitespace) width += ch === "\t" ? 4 : 1;
  return width;
}

function readMarker(line: string): Marker | null {
  const bullet = UL_RE.exec(line);
  if (bullet) {
    const indent = expandedIndent(bullet[1]!);
    return {
      indent,
      contentIndent: indent + 1 + expandedIndent(bullet[3]!),
      ordered: false,
      start: 1,
      content: bullet[4]!,
    };
  }

  const numbered = OL_RE.exec(line);
  if (numbered) {
    const indent = expandedIndent(numbered[1]!);
    return {
      indent,
      contentIndent: indent + numbered[2]!.length + 1 + expandedIndent(numbered[4]!),
      ordered: true,
      start: Number(numbered[2]),
      content: numbered[5]!,
    };
  }

  return null;
}

function stripIndent(line: string, width: number): string {
  let removed = 0;
  let i = 0;
  while (i < line.length && removed < width) {
    const ch = line[i]!;
    if (ch === " ") {
      removed += 1;
      i += 1;
    } else if (ch === "\t") {
      removed += 4;
      i += 1;
    } else {
      break;
    }
  }
  return line.slice(i);
}

function startsBlock(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    /^ {0,3}\$\$/.test(line) ||
    readMarker(line) !== null
  );
}

function renderMathBlock(source: string): string {
  const html = mathRenderer?.render(source, true) ?? null;
  if (html) return html;

  // Without a renderer (or when the expression fails to parse), show the source.
  return `<pre class="md-code md-math-source"><code>${escapeHtml(source)}</code></pre>`;
}

function renderCodeBlock(code: string, language: string): string {
  const lang = language.trim().toLowerCase();
  const highlighted = highlightCode(code, lang);
  return (
    '<div class="md-code-block">' +
    '<div class="md-code-head">' +
    `<span class="md-code-lang">${escapeHtml(lang || "text")}</span>` +
    '<button type="button" class="md-code-copy" data-copy>Copy</button>' +
    "</div>" +
    `<pre class="md-code"><code>${highlighted}</code></pre>` +
    "</div>"
  );
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index];
  const next = lines[index + 1];
  return Boolean(line && next && line.includes("|") && isTableSeparator(next));
}

function renderTable(lines: string[], start: number): [string, number] {
  const header = splitRow(lines[start]!);
  const align = splitRow(lines[start + 1]!).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });

  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || !line.includes("|")) break;
    rows.push(splitRow(line));
    i += 1;
  }

  const cell = (tag: "th" | "td", value: string, column: number): string => {
    const alignment = align[column];
    const cls = alignment ? ` class="md-align-${alignment}"` : "";
    return `<${tag}${cls}>${renderInline(value)}</${tag}>`;
  };

  const head = header.map((value, column) => cell("th", value, column)).join("");
  const body = rows
    .map((row) => `<tr>${header.map((_value, column) => cell("td", row[column] ?? "", column)).join("")}</tr>`)
    .join("");

  return [
    `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    i,
  ];
}

function unwrapParagraphs(html: string): string {
  // Generated HTML only contains <p> wrappers, and list items look best without
  // them (tight list rendering). Code spans are already escaped, so this is safe.
  return html.replace(/<\/?p>/g, "");
}

function parseList(lines: string[], start: number): [string, number] {
  const first = readMarker(lines[start]!)!;
  const baseIndent = first.indent;
  const items: { content: string[] }[] = [];
  const chunk: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      let lookahead = i + 1;
      while (lookahead < lines.length && !lines[lookahead]!.trim()) lookahead += 1;
      if (lookahead >= lines.length) break;

      const nextLine = lines[lookahead]!;
      const nextMarker = readMarker(nextLine);
      const nextIndent = expandedIndent(/^\s*/.exec(nextLine)![0]);
      if ((nextMarker && nextMarker.indent >= baseIndent) || nextIndent > baseIndent + 1) {
        chunk.push("");
        i += 1;
        continue;
      }
      break;
    }

    const marker = readMarker(line);
    if (marker && marker.indent >= baseIndent) {
      chunk.push(line);
      i += 1;
      continue;
    }

    const indent = expandedIndent(/^\s*/.exec(line)![0]);
    if (indent > baseIndent) {
      chunk.push(line);
      i += 1;
      continue;
    }

    break;
  }

  let current: { content: string[] } | null = null;
  let contentIndent = baseIndent + 2;

  for (const line of chunk) {
    const marker = readMarker(line);
    if (marker && marker.indent <= baseIndent + 1) {
      current = { content: [marker.content] };
      items.push(current);
      contentIndent = marker.contentIndent;
      continue;
    }
    if (!current) {
      current = { content: [] };
      items.push(current);
    }
    current.content.push(stripIndent(line, contentIndent));
  }

  const body = items
    .map((item) => {
      const content = item.content.slice();
      let task = false;
      let checked = false;

      const taskMatch = /^\[([ xX])\][ \t]+/.exec(content[0] ?? "");
      if (taskMatch) {
        task = true;
        checked = taskMatch[1]!.toLowerCase() === "x";
        content[0] = content[0]!.slice(taskMatch[0].length);
      }

      let inner = unwrapParagraphs(renderBlocks(content));
      if (task) inner = `<div class="md-li-body">${inner}</div>`;

      const classes = task ? `md-li md-li-task${checked ? " md-li-done" : ""}` : "md-li";
      const box = task ? `<input type="checkbox" class="md-task-box" disabled${checked ? " checked" : ""}>` : "";
      return `<li class="${classes}">${box}${inner}</li>`;
    })
    .join("");

  const tag = first.ordered ? "ol" : "ul";
  const startAttr = first.ordered && first.start !== 1 ? ` start="${first.start}"` : "";
  return [`<${tag}${startAttr} class="md-list">${body}</${tag}>`, i];
}

function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const indent = fence[1] ?? "";
      const marker = fence[2] ?? "```";
      const language = fence[3] ?? "";
      const body: string[] = [];
      i += 1;
      const closing = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
      while (i < lines.length && !closing.test(lines[i]!)) {
        body.push(stripIndent(lines[i]!, indent.length));
        i += 1;
      }
      if (i < lines.length) i += 1;

      const code = body.join("\n");
      const lang = language.trim().toLowerCase();

      if (lang === "mermaid") {
        out.push(
          `<div class="md-diagram md-mermaid" data-diagram="${escapeHtml(code)}">` +
            '<div class="md-diagram-placeholder">Mermaid diagram</div></div>',
        );
      } else if (lang === "asciimath" || lang === "am") {
        out.push(renderMathBlock(code));
      } else {
        out.push(renderCodeBlock(code, language));
      }
      continue;
    }

    // AsciiMath display math: $$ ... $$ (single line or fenced by $$ lines).
    const displayMath = /^ {0,3}\$\$(.*)$/.exec(line);
    if (displayMath && mathRenderer) {
      const rest = displayMath[1] ?? "";
      const trimmedRest = rest.trim();

      if (trimmedRest.length > 2 && trimmedRest.endsWith("$$")) {
        out.push(renderMathBlock(trimmedRest.slice(0, -2)));
        i += 1;
        continue;
      }

      let close = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j]!.includes("$$")) {
          close = j;
          break;
        }
      }

      if (close !== -1) {
        const closingLine = lines[close]!;
        const body = [rest, ...lines.slice(i + 1, close), closingLine.slice(0, closingLine.indexOf("$$"))]
          .join("\n")
          .trim();
        out.push(renderMathBlock(body));
        i = close + 1;
        continue;
      }
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const inner = lines[i]!;
        if (!inner.trim()) break;
        const quotedLine = QUOTE_RE.exec(inner);
        if (quotedLine) {
          quoted.push(quotedLine[1]!);
          i += 1;
          continue;
        }
        if (!startsBlock(inner)) {
          quoted.push(inner);
          i += 1;
          continue;
        }
        break;
      }
      out.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }

    if (readMarker(line)) {
      const [html, next] = parseList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (isTableStart(lines, i)) {
      const [html, next] = renderTable(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const paragraph: string[] = [];
    let setext = 0;

    while (i < lines.length) {
      const current = lines[i]!;
      if (!current.trim()) break;

      if (paragraph.length) {
        if (/^ {0,3}=+[ \t]*$/.test(current)) {
          setext = 1;
          i += 1;
          break;
        }
        if (/^ {0,3}-+[ \t]*$/.test(current)) {
          setext = 2;
          i += 1;
          break;
        }
        if (startsBlock(current) || isTableStart(lines, i)) break;
      }

      paragraph.push(current);
      i += 1;
    }

    if (paragraph.length) {
      const html = renderInline(paragraph.join("\n"));
      out.push(setext ? `<h${setext}>${html}</h${setext}>` : `<p>${html}</p>`);
    }
  }

  return out.join("\n");
}

export function renderMarkdown(source: string): string {
  if (!source.trim()) return "";
  const lines = source.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").split("\n");
  return renderBlocks(lines);
}
