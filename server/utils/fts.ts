// Reusable full-text helpers. Document search uses them today; a later archive
// (for example Slack) can build its own MATCH expression and fuse it the same way.

export const RRF_K = 60
const MAX_FTS_TOKENS = 32

const TOKEN = /\p{L}[\p{L}\p{M}\p{N}]*/gu

export interface FtsClause {
  column?: string
  text: string
}

export interface FusionEntry<T> {
  key: string
  item: T
}

export interface FusedRank<T> {
  key: string
  item: T
  score: number
  ranks: Array<number | null>
}

export function foldDiacritics (value: string): string {
  return value.normalize('NFC').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

export function ftsTokens (value: string): string[] {
  return (value.normalize('NFC').match(TOKEN) ?? []).slice(0, MAX_FTS_TOKENS)
}

export function quoteFtsToken (token: string): string {
  return `"${token.replaceAll('"', '""')}"`
}

export function textHasTokens (value: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const folded = foldDiacritics(value)
  return tokens.every(token => folded.includes(foldDiacritics(token)))
}

function renderClause (tokens: string[], column?: string): string {
  const term = (token: string) => {
    const quoted = quoteFtsToken(token)
    return column ? `${column} : ${quoted}` : quoted
  }
  if (tokens.length === 1) return term(tokens[0] ?? '')
  const all = tokens.map(term).join(' ')
  const phrase = term(tokens.join(' '))
  return `((${all}) OR (${phrase}))`
}

// Slovenian and English inflect at the end of a word (oprema, opreme, opremo;
// budget, budgets). Keep the start of a longer token and match it as a prefix.
export function ftsStem (token: string): string {
  const chars = [...token.normalize('NFC')]
  if (chars.length <= 4) return chars.join('')
  return chars.slice(0, Math.max(4, chars.length - 2)).join('')
}

// Words of three letters or fewer stay exact, so "za" does not match every "zato".
function stemmedTerm (token: string): string {
  return [...token].length <= 3 ? quoteFtsToken(token) : `${quoteFtsToken(ftsStem(token))}*`
}

/**
 * Free-text MATCH that ignores word endings. `all` needs every word; `any`
 * needs one of them and leaves the order to bm25. Column filters stay exact
 * and always apply.
 */
export function buildStemmedFtsMatch (text: string, mode: 'all' | 'any', filters: FtsClause[] = []): string | null {
  const tokens = ftsTokens(text)
  const parts = tokens.length === 0
    ? []
    : [tokens.length === 1 ? stemmedTerm(tokens[0] ?? '') : `(${tokens.map(stemmedTerm).join(mode === 'all' ? ' AND ' : ' OR ')})`]
  const rest = buildFtsMatch(filters)
  if (rest) parts.push(rest)
  return parts.length ? parts.join(' AND ') : null
}

export function buildFtsMatch (clauses: FtsClause[]): string | null {
  const parts = clauses.flatMap((clause) => {
    const tokens = ftsTokens(clause.text)
    if (tokens.length === 0) return []
    return [renderClause(tokens, clause.column)]
  })
  if (parts.length === 0) return null
  return parts.join(' AND ')
}

// Reciprocal rank fusion. `lists` are best-first. A hit's score is the sum of
// 1 / (k + rank) across the lists it appears in. Equal scores prefer a better
// rank in the later lists, so an exact keyword list can win a tie with semantic search.
export function reciprocalRankFusion<T> (lists: ReadonlyArray<ReadonlyArray<FusionEntry<T>>>, k = RRF_K): Array<FusedRank<T>> {
  const scores = new Map<string, FusedRank<T>>()
  lists.forEach((list, listIndex) => {
    const seen = new Set<string>()
    list.forEach((entry, index) => {
      if (seen.has(entry.key)) return
      seen.add(entry.key)
      const rank = index + 1
      const current = scores.get(entry.key)
      const add = 1 / (k + rank)
      if (current) {
        current.score += add
        current.ranks[listIndex] = rank
        return
      }
      const ranks = lists.map(() => null as number | null)
      ranks[listIndex] = rank
      scores.set(entry.key, { key: entry.key, item: entry.item, score: add, ranks })
    })
  })

  return [...scores.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    for (let listIndex = lists.length - 1; listIndex >= 0; listIndex -= 1) {
      const leftRank = left.ranks[listIndex] ?? Number.POSITIVE_INFINITY
      const rightRank = right.ranks[listIndex] ?? Number.POSITIVE_INFINITY
      if (leftRank !== rightRank) return leftRank - rightRank
    }
    return 0
  })
}

export function fuseRankedHits<T extends { score: number }> (
  vectorHits: readonly T[],
  keywordHits: ReadonlyArray<FusionEntry<T>>,
  topK: number,
  keyOf: (item: T) => string
): { fused: boolean, hits: T[] } {
  if (keywordHits.length === 0) {
    return { fused: false, hits: vectorHits.slice(0, topK) }
  }
  const fused = reciprocalRankFusion([
    vectorHits.map(item => ({ key: keyOf(item), item })),
    keywordHits
  ]).slice(0, topK)
  return {
    fused: true,
    hits: fused.map(row => ({ ...row.item, score: row.score }))
  }
}
