<script setup lang="ts">
interface SearchMatch {
  chunkId: string
  documentId: string
  title: string
  chunkIndex: number
  content: string
  score: number
}

interface DocumentDetail {
  id: string
  title: string
  body: string
  createdAt: string
  r2Key: string | null
  chunks: Array<{ id: string, chunkIndex: number, content: string }>
}

const route = useRoute()
const preview = computed(() => import.meta.dev && route.query.preview === '1')
const sampleProjects = ['Atlas', 'Beacon', 'Cedar', 'Delta', 'Ember', 'Fieldwork', 'Harbor', 'Juniper', 'Northstar', 'Signal']
const sampleNotes = [
  ['Project overview', 'The team agreed on the initial scope and documented the decisions that still need sign-off. The next review will cover delivery dates and dependencies.'],
  ['Launch checklist', 'Confirm the staging deployment, review the rollback steps, and ask the project lead to approve the release before notifying stakeholders.'],
  ['Meeting notes', 'The team reviewed open questions and assigned owners. Bring an updated timeline and any unresolved dependencies to the next check-in.'],
  ['Support handover', 'The support team should check the dashboard first, then follow the escalation path in the runbook if the issue persists.'],
  ['Retrospective', 'The team wants to keep the weekly demos and document decisions earlier. Follow-up actions will be reviewed at the next planning session.']
]

const query = ref('')
const archiveEye = ref<{ lookAt: (x: number, y: number) => void } | null>(null)
const queryInput = ref<HTMLInputElement | null>(null)
const queryInvalid = ref(false)
const searching = ref(false)
const searched = ref(false)
const searchError = ref('')
const matches = ref<SearchMatch[]>([])

const selected = ref<DocumentDetail | null>(null)
const detailError = ref('')

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

async function runSearch () {
  if (searching.value) return
  if (!query.value.trim()) {
    queryInvalid.value = true
    queryInput.value?.focus()
    return
  }
  queryInvalid.value = false
  searching.value = true
  searched.value = true
  selected.value = null
  detailError.value = ''
  searchError.value = ''
  try {
    if (preview.value) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      matches.value = sampleProjects.flatMap(project => sampleNotes.map(([title, content]) => ({
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
      body: { query: query.value, topK: 5 }
    })
    matches.value = result.matches
  } catch (error) {
    matches.value = []
    searchError.value = errorMessage(error)
  } finally {
    searching.value = false
  }
}

async function openDocument (id: string) {
  detailError.value = ''
  try {
    selected.value = await $fetch<DocumentDetail>(`/api/documents/${id}`)
  } catch (error) {
    selected.value = null
    detailError.value = errorMessage(error)
  }
}
</script>

<template>
  <main class="search-page">
    <section class="search-hero" aria-labelledby="korwell-title">
      <ArchiveEye ref="archiveEye" />
      <p class="eyebrow">The Kaldi archive</p>
      <h1 id="korwell-title">Korwell</h1>
      <form class="search-bar" role="search" novalidate @submit.prevent="runSearch">
        <label class="sr-only" for="archive-query">Search Kaldi’s knowledge</label>
        <input id="archive-query" ref="queryInput" v-model="query" :aria-invalid="queryInvalid || undefined" :aria-describedby="queryInvalid ? 'archive-query-error' : undefined" @input="queryInvalid = false; followCaret()" @focus="followCaret" @click="followCaret" @keyup="followCaret" type="text" inputmode="search" enterkeyhint="search" name="query" required placeholder="Search Kaldi’s knowledge…">
        <button v-if="query" class="clear-search" type="button" aria-label="Clear search" title="Clear search" @click="clearQuery">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
            <path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="search-eye-button" type="submit" :disabled="searching" :aria-label="searching ? 'Searching…' : 'Search'" title="Search">
          <svg class="search-button-eye" :class="{ 'is-blinking': searching }" viewBox="0 0 40 24" fill="none" aria-hidden="true">
            <path d="M2 12C7 6 13 3 20 3s13 3 18 9c-5 6-11 9-18 9S7 18 2 12Z" stroke="currentColor" stroke-width="2"/>
            <circle cx="20" cy="12" r="5" fill="currentColor"/>
          </svg>
        </button>
      </form>
      <p v-if="queryInvalid" id="archive-query-error" class="query-feedback" role="alert">Enter a search term to look through the archive.</p>
      <p v-if="preview" class="meta">Design preview · sample documents</p>
    </section>

    <section v-if="searched" class="search-results" aria-label="Search results" :aria-busy="searching">
      <p v-if="searching" role="status">Searching the archive…</p>
      <p v-else-if="searchError" class="err" role="alert">{{ searchError }}</p>
      <p v-else-if="!matches.length" role="status">No matching passages found. Try a different search.</p>
      <template v-else>
        <h2>{{ preview ? `${matches.length} sample results` : 'From the archive' }}</h2>
        <ol class="results">
          <li v-for="match in matches" :key="match.chunkId" class="result">
            <h3>{{ match.title || 'Untitled' }}</h3>
            <p class="chunk">{{ match.content || 'Passage unavailable.' }}</p>
            <button v-if="match.documentId" class="ghost" type="button" @click="openDocument(match.documentId)">Open document</button>
          </li>
        </ol>
        <p v-if="detailError" class="err" role="alert">{{ detailError }}</p>
        <article v-if="selected" class="card">
          <h2>{{ selected.title }}</h2>
          <pre class="body">{{ selected.body }}</pre>
        </article>
      </template>
    </section>
  </main>
</template>
