import { describe, expect, test } from "bun:test";
import { escapeHtml, renderInline, renderMarkdown, setMathRenderer } from "../src/markdown";

describe("block rendering", () => {
  test("headings", () => {
    expect(renderMarkdown("# Title")).toBe("<h1>Title</h1>");
    expect(renderMarkdown("### Deep ###")).toBe("<h3>Deep</h3>");
  });

  test("setext headings", () => {
    expect(renderMarkdown("Title\n=====")).toBe("<h1>Title</h1>");
    expect(renderMarkdown("Sub\n---")).toBe("<h2>Sub</h2>");
  });

  test("paragraphs and hard breaks", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p>\n<p>three</p>");
  });

  test("horizontal rule", () => {
    expect(renderMarkdown("***")).toBe("<hr>");
    expect(renderMarkdown("- - -")).toBe("<hr>");
  });

  test("blockquotes, including nested Markdown", () => {
    expect(renderMarkdown("> quoted **text**")).toBe(
      "<blockquote><p>quoted <strong>text</strong></p></blockquote>",
    );
  });

  test("unordered, ordered and nested lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe(
      '<ul class="md-list"><li class="md-li">a</li><li class="md-li">b</li></ul>',
    );
    expect(renderMarkdown("3. a\n4. b")).toContain('<ol start="3"');

    const nested = renderMarkdown("- a\n  - b\n- c");
    expect(nested).toMatch(/<li class="md-li">a\s*<ul class="md-list">/);
    expect(nested).toContain('<li class="md-li">c</li>');
  });

  test("task lists", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('class="md-li md-li-task md-li-done"');
    expect(html).toContain("checked");
    expect(html).toContain('<div class="md-li-body">todo</div>');
  });

  test("fenced code blocks are escaped and highlighted", () => {
    const html = renderMarkdown('```ts\nconst x = "a<b";\n```');
    expect(html).toContain('<div class="md-code-block">');
    expect(html).toContain('<span class="md-code-lang">ts</span>');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain("&quot;a&lt;b&quot;");
  });

  test("unknown languages fall back to escaped text", () => {
    const html = renderMarkdown("```weird\n<hi>\n```");
    expect(html).toContain("&lt;hi&gt;");
  });

  test("tables with alignment", () => {
    const html = renderMarkdown("| a | b |\n| :-- | --: |\n| 1 | 2 |");
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('class="md-align-left"');
    expect(html).toContain('class="md-align-right"');
    expect(html).toContain('<td class="md-align-left">1</td>');
  });

  test("raw HTML is never injected", () => {
    const html = renderMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("inline rendering", () => {
  test("emphasis", () => {
    expect(renderInline("**bold** and *italic* and ~~strike~~")).toBe(
      "<strong>bold</strong> and <em>italic</em> and <del>strike</del>",
    );
    expect(renderInline("***both***")).toBe("<em><strong>both</strong></em>");
    expect(renderInline("snake_case_name stays put")).toBe("snake_case_name stays put");
  });

  test("inline code is not parsed further", () => {
    expect(renderInline("`**not bold**`")).toBe('<code class="md-inline-code">**not bold**</code>');
  });

  test("links, images and autolinks", () => {
    expect(renderInline("[Zed](https://zed.dev)")).toContain('href="https://zed.dev"');
    expect(renderInline("![alt](pic.png)")).toContain('src="pic.png"');
    expect(renderInline("<https://zed.dev>")).toContain('href="https://zed.dev"');
    expect(renderInline("see https://zed.dev/docs.")).toContain('href="https://zed.dev/docs"');
    expect(renderInline("see https://zed.dev/docs.")).toContain("</a>.");
  });

  test("backslash escapes", () => {
    expect(renderInline("\\*not italic\\*")).toBe("*not italic*");
  });

  test("unbalanced markers do not break", () => {
    expect(renderInline("2 * 3 = 6")).toBe("2 * 3 = 6");
    expect(renderInline("**unclosed")).toBe("**unclosed");
  });

  test("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("math", () => {
  const stub = {
    render: (source: string, display: boolean) =>
      display
        ? `<div class="md-math md-math-block"><math data-display="block">${escapeHtml(source)}</math></div>`
        : `<span class="md-math"><math data-display="inline">${escapeHtml(source)}</math></span>`,
  };

  test("inline $...$ is rendered", () => {
    setMathRenderer(stub);
    expect(renderInline("energy $E=mc^2$ here")).toContain('<math data-display="inline">E=mc^2</math>');
    expect(renderInline("energy $E=mc^2$ here")).toContain("energy ");
    setMathRenderer(null);
  });

  test("dollar amounts are not treated as math", () => {
    setMathRenderer(stub);
    expect(renderInline("$5 and $10")).toBe("$5 and $10");
    expect(renderInline("costs $12")).toBe("costs $12");
    expect(renderInline("$a\nb$")).toBe("$a<br>b$");
    setMathRenderer(null);
  });

  test("escaped dollars stay literal", () => {
    setMathRenderer(stub);
    expect(renderInline("\\$x\\$ not math")).toBe("$x$ not math");
    setMathRenderer(null);
  });

  test("display math on one line and across lines", () => {
    setMathRenderer(stub);
    expect(renderMarkdown("$$a+b$$")).toContain('<math data-display="block">a+b</math>');

    const block = renderMarkdown("$$\nsum_(i=1)^n i\n$$");
    expect(block).toContain('<math data-display="block">sum_(i=1)^n i</math>');
    setMathRenderer(null);
  });

  test("fenced asciimath blocks", () => {
    setMathRenderer(stub);
    const html = renderMarkdown("```asciimath\nx^2 + y^2\n```");
    expect(html).toContain('<math data-display="block">x^2 + y^2</math>');
    expect(html).not.toContain("md-code");
    setMathRenderer(null);
  });

  test("without a renderer the source is left alone", () => {
    setMathRenderer(null);
    expect(renderInline("a $x$ b")).toBe("a $x$ b");
    expect(renderMarkdown("$$\nx\n$$")).not.toContain("md-math");
  });
});

describe("diagrams", () => {
  test("mermaid fences become placeholders with the source", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n  A-->B\n```");
    expect(html).toContain('class="md-diagram md-mermaid"');
    expect(html).toContain('data-diagram="graph TD\n  A--&gt;B"');
    expect(html).not.toContain("md-code");
  });
});

describe("charts", () => {
  test("chart fences become placeholders carrying the JSON config", () => {
    const html = renderMarkdown('```chart\n{ "type": "bar", "data": { "labels": ["a"] } }\n```');
    expect(html).toContain('class="md-chart"');
    expect(html).toContain('data-chart="{ &quot;type&quot;: &quot;bar&quot;');
    expect(html).toContain("md-chart-placeholder");
    expect(html).not.toContain("md-code");
  });
});

describe("robustness", () => {
  test("empty and whitespace-only input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n\n  ")).toBe("");
  });

  test("long single-line note renders quickly", () => {
    const source = "word ".repeat(8000);
    const started = performance.now();
    renderMarkdown(source);
    expect(performance.now() - started).toBeLessThan(400);
  });
});
