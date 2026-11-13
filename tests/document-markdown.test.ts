import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDocumentMarkdown } from '../app/utils/documentMarkdown.ts'

test('renderDocumentMarkdown escapes HTML and only links safe URLs', () => {
  // Document bodies are shown with v-html, and anyone can upload one.
  const html = renderDocumentMarkdown([
    '<img src=x onerror=alert(1)> <script>alert(1)</script>',
    '[js](javascript:alert(1)) [vb](vbscript:x) [data](data:text/html,<script>alert(1)</script>)',
    '[ok](https://kaldi.si/a) ![pixel](https://tracker.example/p.gif) ![svg](data:image/svg+xml,<svg onload=alert(1)>)',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
  ].join('\n'))

  assert.ok(!/<(img|script)\b/i.test(html), html)
  assert.ok(!/href="(?:javascript|vbscript|data):/i.test(html), html)
  assert.ok(!/\son\w+=/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), html)
  assert.ok(html.includes('<a href="https://kaldi.si/a" target="_blank" rel="noopener noreferrer nofollow">ok</a>'))
  // A remote image becomes a link, so opening a document fetches nothing from third parties.
  assert.ok(html.includes('<a href="https://tracker.example/p.gif" target="_blank" rel="noopener noreferrer nofollow">pixel</a>'))
  assert.ok(html.includes('<table>'))
})
