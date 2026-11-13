import MarkdownIt from 'markdown-it'

// Renders a library document's body (uploaded markdown, or Workers AI toMarkdown
// output from PDF, Word, and Excel) for the reader pane. Unlike chat answers,
// documents are full markdown: tables, quotes, nested lists, rules.
//
// Safety: raw HTML in the source is escaped, never rendered (`html: false`).
// Links must be http(s) or mailto; anything else (javascript:, vbscript:, file:,
// relative paths) is left as plain text. Remote images are shown as links, so
// opening a document never makes the browser fetch from a third-party server.

const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i
// Inline images that carry their own bytes. SVG is left out: it can hold script.
const INLINE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);/i

const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

md.validateLink = (url: string) => {
  const href = url.trim()
  return SAFE_LINK.test(href) || INLINE_IMAGE.test(href)
}

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  if (/^https?:/i.test(token.attrGet('href') ?? '')) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer nofollow')
  }
  return defaultLinkOpen(tokens, index, options, env, self)
}

md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]!
  const src = token.attrGet('src') ?? ''
  const alt = token.content
  if (INLINE_IMAGE.test(src)) {
    return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}" loading="lazy">`
  }
  const label = md.utils.escapeHtml(alt || 'Image')
  if (!/^https?:/i.test(src)) return label
  return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
}

// The page title is the <h1>, so headings in the body move one level down.
const shiftHeading = (tag: string) => `h${Math.min(Number(tag.slice(1)) + 1, 6)}`
for (const rule of ['heading_open', 'heading_close'] as const) {
  md.renderer.rules[rule] = (tokens, index, options, _env, self) => {
    const token = tokens[index]!
    token.tag = shiftHeading(token.tag)
    return self.renderToken(tokens, index, options)
  }
}

// Wide tables (spreadsheets) scroll sideways inside the column instead of the page.
md.renderer.rules.table_open = () => '<div class="document-table"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'

export function renderDocumentMarkdown (source: string): string {
  return md.render(source)
}
