/**
 * AsciiMath → Presentation MathML.
 *
 * Rendering to native MathML keeps the build self-contained: there are no font
 * files to inline (unlike KaTeX) and every modern browser displays it natively.
 */

import { parseMath, translate } from "asciimath";

// ASCIIMathML scans and rewrites the whole document once, on DOMContentLoaded.
// Running its one-shot pass now (against the static shell) marks it as done, so
// it can never rewrite rendered notes that happen to contain backticks later.
translate();

/** Returns MathML markup, or null when the expression could not be parsed. */
export function renderAsciiMath(source: string, display: boolean): string | null {
  const input = source.trim();
  if (!input) return null;

  try {
    const node = parseMath(input, false) as Element | null;
    if (!node) return null;

    // ASCIIMathML defaults to blue serif math; inherit the note's text colour instead
    // and only use display-style fractions for display blocks.
    for (const element of node.querySelectorAll("[mathcolor]")) element.removeAttribute("mathcolor");
    const style = node.firstElementChild;
    if (style) style.setAttribute("displaystyle", display ? "true" : "false");

    node.setAttribute("display", display ? "block" : "inline");
    const markup = node.outerHTML;

    return display
      ? `<div class="md-math md-math-block">${markup}</div>`
      : `<span class="md-math">${markup}</span>`;
  } catch {
    return null;
  }
}
