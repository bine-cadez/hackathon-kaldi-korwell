<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { documentByIdQuery } from '~/queries/documents'

interface SearchMatch {
  chunkId: string
  documentId: string
  title: string
  author?: string | null
  createdAt?: string | null
  chunkIndex: number
  content: string
  score: number
}

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

const corpus = ref<'documents' | 'slack'>('documents')
const query = ref('')
const fromDate = ref('')
const toDate = ref('')
const titleFilter = ref('')
const authorFilter = ref('')
const archiveEye = ref<{ lookAt: (x: number, y: number) => void } | null>(null)
const queryInput = ref<HTMLInputElement | null>(null)
const queryInvalid = ref(false)
const searching = ref(false)
const searched = ref(false)
// Raw error so ErrorState can tell a network failure from a server one.
const searchError = ref<unknown>(null)
const matches = ref<SearchMatch[]>([])

// Shares the document cache with the Library, so a document opened in either is instant in the other.
const openedId = ref<string | null>(null)
const request = useRequestFetch()
const { data: selected, error: detailError, isPending: detailPending, asyncStatus: detailAsyncStatus, refetch: retryDetail } = useQuery(() => ({
  ...documentByIdQuery({ id: openedId.value ?? '', request }),
  enabled: !!openedId.value
}))
const openedMatch = computed(() => matches.value.find(match => match.documentId === openedId.value))

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

async function runSearch () {
  if (searching.value) return
  if (!query.value.trim() && !titleFilter.value.trim() && !authorFilter.value.trim()) {
    queryInvalid.value = true
    queryInput.value?.focus()
    return
  }
  queryInvalid.value = false
  searching.value = true
  searched.value = true
  openedId.value = null
  searchError.value = null
  try {
    if (preview.value) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      matches.value = route.query.preview === 'empty' ? [] : sampleProjects.flatMap(project => sampleNotes.map(([title, content]) => ({
        chunkId: `preview-${project}-${title}`,
        documentId: '',
        title: `${project} · ${title}`,
        chunkIndex: 0,
        content,
        score: 0
      })))
      return
    }
    const result = await $fetch<{ matches: SearchMatch[] }>('/api/search', {
      method: 'POST',
      body: {
        query: query.value,
        topK: 5,
        from: fromDate.value || undefined,
        to: toDate.value || undefined,
        title: titleFilter.value || undefined,
        author: authorFilter.value || undefined
      }
    })
    matches.value = result.matches
  } catch (error) {
    matches.value = []
    searchError.value = error
  } finally {
    searching.value = false
  }
}

function openDocument (id: string) {
  openedId.value = id
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
      <ErrorState v-else-if="searchError" :error="searchError" title="Search didn’t finish" @retry="runSearch()" />
      <p v-else-if="!matches.length" role="status">No matching passages found. Try a different search.</p>
      <template v-else>
        <h2>{{ preview ? `${matches.length} sample results` : 'From the archive' }}</h2>
        <ol class="results">
          <li v-for="match in matches" :key="match.chunkId" class="result">
            <h3>{{ match.title || 'Untitled' }}</h3>
            <p v-if="match.author || match.createdAt" class="meta">
              <span v-if="match.author">{{ match.author }}</span><span v-if="match.author && match.createdAt"> · </span><span v-if="match.createdAt">{{ match.createdAt.slice(0, 10) }}</span>
            </p>
            <p class="chunk">{{ match.content || 'Passage unavailable.' }}</p>
            <button v-if="match.documentId" class="ghost" type="button" @click="openDocument(match.documentId)">Open document</button>
          </li>
        </ol>
        <article v-if="openedId && detailError" class="card">
          <h2>{{ openedMatch?.title || 'Document' }}</h2>
          <ErrorState
            :error="detailError"
            title="Couldn’t open this document"
            :retrying="detailAsyncStatus === 'loading'"
            @retry="retryDetail()"
            @dismiss="openedId = null"
          />
        </article>
        <article v-else-if="openedId && detailPending" class="card" aria-busy="true">
          <h2>{{ openedMatch?.title || 'Opening document' }}</h2>
          <p v-if="openedMatch?.author" class="meta">{{ openedMatch.author }}</p>
          <p role="status" class="sr-only">Opening {{ openedMatch?.title || 'document' }}…</p>
          <DocBodySkeleton />
        </article>
        <article v-else-if="openedId && selected" class="card">
          <h2>{{ selected.title }}</h2>
          <p v-if="selected.author" class="meta">{{ selected.author }}</p>
          <pre class="body">{{ selected.body }}</pre>
        </article>
      </template>
    </section>
  </main>
</template>
