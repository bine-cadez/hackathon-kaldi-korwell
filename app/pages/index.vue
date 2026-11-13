<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { SEARCH_QUERY_KEYS, documentPath, documentSearchQuery, type SearchMatch, type SearchParams } from '~/queries/documents'

// Excerpts checked against the text of Nineteen Eighty-Four, Parts I and II.
const archiveQuotes = [
  'The best books, he perceived, are those that tell you what you know already.',
  'The heresy of heresies was common sense.',
  'Sanity is not statistical',
  'I understand HOW',
  'understand WHY',
  'The solid world exists',
  'a taste for solitude',
  'ownlife',
  'real coffee',
  'a tiny world',
  'thoughts to words',
  'human heritage',
  'profound wisdom'
]
const archiveQuote = ref('')

onMounted(() => {
  const key = 'korwell-archive-quote'
  let index = 0
  try {
    index = (Number(sessionStorage.getItem(key) ?? -1) + 1) % archiveQuotes.length
    sessionStorage.setItem(key, String(index))
  } catch {
    index = Math.floor(Math.random() * archiveQuotes.length)
  }
  archiveQuote.value = archiveQuotes[index] ?? archiveQuotes[0]!
})

const route = useRoute()
const preview = computed(() => import.meta.dev && (route.query.preview === '1' || route.query.preview === 'empty'))
const sampleProjects = ['Atlas', 'Beacon', 'Cedar', 'Delta', 'Ember', 'Fieldwork', 'Harbor', 'Juniper', 'Northstar', 'Signal']
const sampleNotes = [
  ['Project overview', 'The team agreed on the initial scope and documented the decisions that still need sign-off. The next review will cover delivery dates and dependencies.'],
  ['Launch checklist', 'Confirm the staging deployment, review the rollback steps, and ask the project lead to approve the release before notifying stakeholders.'],
  ['Meeting notes', 'The team reviewed open questions and assigned owners. Bring an updated timeline and any unresolved dependencies to the next check-in.'],
  ['Support handover', 'The support team should check the dashboard first, then follow the escalation path in the runbook if the issue persists.'],
  ['Retrospective', 'The team wants to keep the weekly demos and document decisions earlier. Follow-up actions will be reviewed at the next planning session.']
]

const router = useRouter()
const request = useRequestFetch()

// The search lives in the URL (/?q=…&from=…&author=…), so results can be shared
// and reloaded, and Back from a document page returns to them (cached).
function queryText (value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 2000) : ''
}
function queryDate (value: unknown): string {
  const raw = queryText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}
const searchParams = computed((): SearchParams => ({
  q: queryText(route.query.q),
  from: queryDate(route.query.from),
  to: queryDate(route.query.to),
  title: queryText(route.query.title).slice(0, 200),
  author: queryText(route.query.author).slice(0, 200)
}))
const searched = computed(() => Boolean(searchParams.value.q || searchParams.value.title || searchParams.value.author))

const corpus = ref<'documents' | 'slack'>('documents')
// Form fields: edited freely, applied to the URL on submit.
const query = ref(searchParams.value.q)
const fromDate = ref(searchParams.value.from)
const toDate = ref(searchParams.value.to)
const titleFilter = ref(searchParams.value.title)
const authorFilter = ref(searchParams.value.author)
// Back/forward to another search: show its terms in the form.
watch(searchParams, (params) => {
  query.value = params.q
  fromDate.value = params.from
  toDate.value = params.to
  titleFilter.value = params.title
  authorFilter.value = params.author
})
const archiveEye = ref<{ lookAt: (x: number, y: number) => void } | null>(null)
const queryInput = ref<HTMLInputElement | null>(null)
const queryInvalid = ref(false)

function previewMatches (): SearchMatch[] {
  if (route.query.preview === 'empty') return []
  return sampleProjects.flatMap(project => sampleNotes.map(([title, content]) => ({
    chunkId: `preview-${project}-${title}`,
    documentId: '',
    title: `${project} · ${title}`,
    chunkIndex: 0,
    content: content!,
    score: 0
  })))
}

const {
  data: searchResult,
  error: searchError,
  asyncStatus: searchStatus,
  refetch: refetchSearch
} = useQuery(() => preview.value
  ? {
      key: [...SEARCH_QUERY_KEYS.root, 'preview', { ...searchParams.value, preview: String(route.query.preview) }],
      query: async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))
        return { matches: previewMatches() }
      },
      enabled: searched.value
    }
  : { ...documentSearchQuery({ params: searchParams.value, request }), enabled: searched.value })
const searching = computed(() => searched.value && searchStatus.value === 'loading')
const matches = computed(() => searchResult.value?.matches ?? [])

let caretFrame = 0
let caretMeasure: CanvasRenderingContext2D | null = null

function followCaret () {
  cancelAnimationFrame(caretFrame)
  caretFrame = requestAnimationFrame(() => {
    const input = queryInput.value
    if (!input || document.activeElement !== input) return
    caretMeasure ??= document.createElement('canvas').getContext('2d')
    if (!caretMeasure) return

    const style = getComputedStyle(input)
    const bounds = input.getBoundingClientRect()
    const start = bounds.left + input.clientLeft + parseFloat(style.paddingLeft)
    const end = start + input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    caretMeasure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const caret = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd
    const width = caretMeasure.measureText(input.value.slice(0, caret ?? 0)).width
    const x = Math.max(start, Math.min(end, start + width - input.scrollLeft))
    archiveEye.value?.lookAt(x, bounds.top + bounds.height / 2)
  })
}

onMounted(() => document.addEventListener('selectionchange', followCaret))
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', followCaret)
  cancelAnimationFrame(caretFrame)
})

function clearQuery () {
  query.value = ''
  queryInvalid.value = false
  queryInput.value?.focus()
  followCaret()
}

function clearFilters () {
  fromDate.value = ''
  toDate.value = ''
  titleFilter.value = ''
  authorFilter.value = ''
}

function runSearch () {
  if (searching.value) return
  if (!query.value.trim() && !titleFilter.value.trim() && !authorFilter.value.trim()) {
    queryInvalid.value = true
    queryInput.value?.focus()
    return
  }
  queryInvalid.value = false
  const next: Record<string, string> = {}
  if (query.value.trim()) next.q = query.value.trim()
  if (fromDate.value) next.from = fromDate.value
  if (toDate.value) next.to = toDate.value
  if (titleFilter.value.trim()) next.title = titleFilter.value.trim()
  if (authorFilter.value.trim()) next.author = authorFilter.value.trim()
  if (typeof route.query.preview === 'string') next.preview = route.query.preview
  const same = Object.keys(next).length === Object.keys(route.query).length
    && Object.entries(next).every(([key, value]) => route.query[key] === value)
  // The same search again means "search again"; a new one gets its own history entry.
  if (same) refetchSearch()
  else router.push({ query: next })
}
</script>

<template>
  <main class="search-page">
    <section class="search-hero" aria-labelledby="korwell-title">
      <ArchiveEye ref="archiveEye" :searching="searching" :no-results="corpus === 'documents' && searched && !searching && !searchError && !matches.length" />
      <p class="eyebrow archive-quote"><q v-if="archiveQuote">{{ archiveQuote }}</q></p>
      <h1 id="korwell-title">Korwell</h1>
      <div class="corpus-tabs" role="tablist" aria-label="What to search">
        <button type="button" role="tab" :aria-selected="corpus === 'documents'" @click="corpus = 'documents'">Documents</button>
        <button type="button" role="tab" :aria-selected="corpus === 'slack'" @click="corpus = 'slack'">Slack</button>
      </div>
      <SlackSearch v-if="corpus === 'slack'" />
      <form v-else class="search-form" role="search" novalidate @submit.prevent="runSearch">
        <div class="search-bar">
          <label class="sr-only" for="archive-query">Search the records</label>
          <input id="archive-query" ref="queryInput" v-model="query" :aria-invalid="queryInvalid || undefined" :aria-describedby="queryInvalid ? 'archive-query-error' : undefined" @input="queryInvalid = false; followCaret()" @focus="followCaret" @click="followCaret" @keyup="followCaret" type="text" inputmode="search" enterkeyhint="search" name="query" placeholder="Search the records…">
          <button v-if="query" class="clear-search" type="button" aria-label="Clear search" title="Clear search" @click="clearQuery">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
              <path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="search-submit" type="submit" :disabled="searching" :aria-label="searching ? 'Searching…' : 'Search'" title="Search">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="2"/>
              <path d="m15 15 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="search-filters">
          <label>
            From
            <input v-model="fromDate" type="date" name="from">
          </label>
          <label>
            To
            <input v-model="toDate" type="date" name="to">
          </label>
          <label>
            Title
            <input v-model="titleFilter" type="text" name="title" maxlength="200" placeholder="Words in the title">
          </label>
          <label>
            Author
            <input v-model="authorFilter" type="text" name="author" maxlength="200" placeholder="Words in the author">
          </label>
          <button v-if="fromDate || toDate || titleFilter || authorFilter" class="clear-filters" type="button" @click="clearFilters">Clear filters</button>
        </div>
        <p class="meta search-filter-note">Dates include the whole day, in UTC.</p>
      </form>
      <p v-if="corpus === 'documents' && queryInvalid" id="archive-query-error" class="query-feedback" role="alert">Enter a search term, a title, or an author.</p>
      <p v-if="preview" class="meta">Design preview · sample documents</p>
    </section>

    <section v-if="corpus === 'documents' && searched" class="search-results" aria-label="Search results" :aria-busy="searching">
      <template v-if="searching">
        <p role="status" class="sr-only">Searching the archive…</p>
        <ResultSkeleton />
      </template>
      <ErrorState v-else-if="searchError" :error="searchError" title="Search didn’t finish" @retry="refetchSearch()" />
      <p v-else-if="!matches.length" role="status">No matching passages found. Try a different search.</p>
      <template v-else>
        <h2>{{ preview ? `${matches.length} sample results` : 'From the archive' }}</h2>
        <ol class="results">
          <li v-for="match in matches" :key="match.chunkId" class="result">
            <h3>
              <NuxtLink v-if="match.documentId" :to="documentPath(match.documentId)">{{ match.title || 'Untitled' }}</NuxtLink>
              <template v-else>{{ match.title || 'Untitled' }}</template>
            </h3>
            <p v-if="match.author || match.createdAt" class="meta">
              <span v-if="match.author">{{ match.author }}</span><span v-if="match.author && match.createdAt"> · </span><span v-if="match.createdAt">{{ match.createdAt.slice(0, 10) }}</span>
            </p>
            <p class="chunk">{{ match.content || 'Passage unavailable.' }}</p>
            <p v-if="match.documentId" class="result-actions">
              <NuxtLink class="button-link" :to="documentPath(match.documentId)" :aria-label="`Open ${match.title || 'document'}`">Open document</NuxtLink>
            </p>
          </li>
        </ol>
      </template>
    </section>
  </main>
</template>
