// A small markdown renderer for chat answers. Everything is escaped first, so
// model output (which may quote documents or Slack) can never inject HTML.
// Supports paragraphs, headings, bullet and numbered lists, code fences,
// inline code, bold, italic, and links.
//
// Links: a document or Slack message could tell the model to write a link that
// carries conversation data to another site. So only two kinds of link are
// clickable: library documents in this app, and external URLs a tool returned
// for this answer (`allowed`). Anything else is shown as plain text.

function escapeHtml (text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const LIBRARY_LINK = /^\/library\?document=[\w-]+$/

export function safeHref (url: string, allowed: ReadonlySet<string> = new Set()): string | null {
  const href = url.trim()
  if (LIBRARY_LINK.test(href)) return href
  if (/^https?:\/\/[^\s]+$/i.test(href) && allowed.has(href)) return href
  return null
}

const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\s][^*\n]*?)\*/g

function emphasis (text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*\n]*?)\*/g, '<em>$1</em>')
}

export function renderInline (text: string, allowed: ReadonlySet<string> = new Set()): string {
  let html = ''
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    html += escapeHtml(text.slice(last, index))
    last = index + match[0].length
    const [whole, code, label, url, bold, italic] = match
    if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`
    } else if (label !== undefined && url !== undefined) {
      const href = safeHref(url, allowed)
      if (!href) {
        html += escapeHtml(whole)
      } else {
        const external = !href.startsWith('/')
        html += `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${emphasis(label)}</a>`
      }
    } else if (bold !== undefined) {
      html += `<strong>${escapeHtml(bold)}</strong>`
    } else if (italic !== undefined) {
      html += `<em>${escapeHtml(italic)}</em>`
    }
  }
  return html + escapeHtml(text.slice(last))
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s*(#{1,6})\s+(.*)$/
const FENCE = /^\s*```/

export function renderChatMarkdown (source: string, allowed: ReadonlySet<string> = new Set()): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: { tag: 'ul' | 'ol', items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(line => renderInline(line, allowed)).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map(item => `<li>${renderInline(item, allowed)}</li>`).join('')}</${list.tag}>`)
    list = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (FENCE.test(line)) {
      flushParagraph()
      flushList()
      const code: string[] = []
      index += 1
      // An unclosed fence (still streaming) runs to the end of the text.
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        code.push(lines[index]!)
        index += 1
      }
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const tag = heading[1]!.length <= 2 ? 'h3' : 'h4'
      blocks.push(`<${tag}>${renderInline(heading[2]!, allowed)}</${tag}>`)
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (list?.tag !== tag) {
        flushList()
        list = { tag, items: [] }
      }
      list!.items.push((bullet ?? numbered)![1]!)
      continue
    }
    // A plain line right after a list item continues that item.
    if (list) {
      const items = (list as { items: string[] }).items
      items[items.length - 1] += ` ${line.trim()}`
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks.join('')
}
