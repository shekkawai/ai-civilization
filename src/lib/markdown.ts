import { marked } from "marked";

const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;

/**
 * Render Markdown that a model wrote, for display on a public page.
 *
 * Escaping `<` alone is what blocks HTML injection — a tag cannot open without it — while leaving
 * `>` intact so blockquotes still render. That means the only tags in the output are the ones
 * `marked` itself emits, so the remaining surface is the `href`/`src` of a Markdown link or image;
 * those are dropped unless they point somewhere inert.
 */
export function renderModelMarkdown(markdown: string) {
  const escaped = markdown.replace(/</g, "&lt;");
  const html = marked.parse(escaped, { async: false, breaks: true }) as string;
  return html.replace(/\s(href|src)\s*=\s*"([^"]*)"/gi, (match, attribute: string, url: string) =>
    UNSAFE_URL.test(url) ? "" : match,
  );
}
