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

// Excerpts from Nineteen Eighty-Four, Parts I–III and the Newspeak appendix.
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
  'profound wisdom',
  'the clocks were striking thirteen',
  'BIG BROTHER IS WATCHING YOU',
  'a time when thought is free',
  'To mark the paper was the decisive act.',
  'the place where there is no darkness',
  'a link of understanding between them',
  'the memory of the lost chocolate',
  'To know and not to know',
  'the labyrinthine world of doublethink',
  'to use logic against logic',
  'no record outside your own memory',
  'the destruction of words',
  'the range of thought',
  'the range of consciousness',
  'Newspeak is Ingsoc and Ingsoc is Newspeak',
  'Everything faded into mist.',
  'The past was erased',
  'the erasure was forgotten',
  'the lie became truth',
  'unmistakable evidence of an act of falsification',
  'Freedom is the freedom to say that two plus two make four.',
  'If that is granted, all else follows.',
  'All history was a palimpsest',
  'I love you.',
  'a scrap of paper',
  'the memory hole',
  'the Golden Country',
  'a sort of vague reverence',
  'at the heart of the crystal',
  'no ear at the keyhole',
  'poverty and ignorance',
  'the possibility of independent thought',
  'Thus history is continuously rewritten.',
  'Who controls the present controls the past',
  'In records. It is written down.',
  'In the mind. In human memories.',
  'the eyes of the Party',
  'The object of power is power.',
  'Obedience is not enough.',
  'TWO AND TWO MAKE FIVE',
  'Oldspeak',
  'crimethink',
  'thinkpol',
  'goodthink',
  'All ambiguities and shades of meaning',
  'a sort of verbal shorthand',
  'duckspeak',
  'Big Brother is ungood',
  'the last link with the past',
  'in full control of all records'
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
const corpusTabs = [
  { label: 'Documents', value: 'documents' },
  { label: 'Slack', value: 'slack' }
]
const query = ref('')
const fromDate = ref('')
const toDate = ref('')
const titleFilter = ref('')
const authorFilter = ref('')
const archiveEye = ref<{ lookAt: (x: number, y: number) => void } | null>(null)
const queryField = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const queryInput = computed(() => queryField.value?.inputRef ?? null)
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
  <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-4">
    <section class="text-center" aria-labelledby="korwell-title">
      <ArchiveEye ref="archiveEye" :searching="searching" :no-results="corpus === 'documents' && searched && !searching && !searchError && !matches.length" />
      <p class="eyebrow mx-auto mt-3 mb-4 min-h-[1.5em] leading-normal text-muted"><q v-if="archiveQuote">{{ archiveQuote }}</q></p>
      <h1 id="korwell-title" class="mb-5 text-[clamp(4rem,13vw,7.5rem)] leading-none text-primary">Korwell</h1>
      <UTabs
        v-model="corpus"
        :items="corpusTabs"
        :content="false"
        aria-label="What to search"
        class="mx-auto mb-4 w-fit"
        :ui="{ list: 'rounded-full bg-default ring ring-default', indicator: 'rounded-full bg-primary', trigger: 'rounded-full px-4 font-bold data-[state=active]:text-paper data-[state=inactive]:text-primary' }"
      />
      <SlackSearch v-if="corpus === 'slack'" />
      <form v-else class="grid gap-3.5" role="search" novalidate @submit.prevent="runSearch">
        <SearchBar
          ref="queryField"
          v-model="query"
          input-id="archive-query"
          label="Search the records"
          placeholder="Search the records…"
          :searching="searching"
          :invalid="queryInvalid"
          :described-by="queryInvalid ? 'archive-query-error' : undefined"
          clearable
          inputmode="search"
          enterkeyhint="search"
          @input="queryInvalid = false; followCaret()"
          @focus="followCaret"
          @click="followCaret"
          @keyup="followCaret"
          @clear="clearQuery"
        />
        <SearchFilters :active="!!(fromDate || toDate || titleFilter || authorFilter)" @clear="clearFilters">
          <UFormField label="From">
            <UInput v-model="fromDate" type="date" name="from" class="w-full" />
          </UFormField>
          <UFormField label="To">
            <UInput v-model="toDate" type="date" name="to" class="w-full" />
          </UFormField>
          <UFormField label="Title">
            <UInput v-model="titleFilter" name="title" maxlength="200" placeholder="Words in the title" class="w-full" />
          </UFormField>
          <UFormField label="Author">
            <UInput v-model="authorFilter" name="author" maxlength="200" placeholder="Words in the author" class="w-full" />
          </UFormField>
        </SearchFilters>
        <p class="m-0 text-start text-sm text-muted">Dates include the whole day, in UTC.</p>
      </form>
      <UAlert
        v-if="corpus === 'documents' && queryInvalid"
        id="archive-query-error"
        role="alert"
        color="warning"
        variant="subtle"
        class="mt-3 text-start"
        title="Enter a search term, a title, or an author."
      />
      <p v-if="preview" class="text-sm text-muted">Design preview · sample documents</p>
    </section>

    <section v-if="corpus === 'documents' && searched" class="mt-8 border-t-3 border-double border-default pt-4" aria-label="Search results" :aria-busy="searching">
      <template v-if="searching">
        <p role="status" class="sr-only">Searching the archive…</p>
        <ResultSkeleton />
      </template>
      <ErrorState v-else-if="searchError" :error="searchError" title="Search didn’t finish" @retry="runSearch()" />
      <p v-else-if="!matches.length" role="status">No matching passages found. Try a different search.</p>
      <template v-else>
        <h2 class="text-2xl">{{ preview ? `${matches.length} sample results` : 'From the archive' }}</h2>
        <ol class="mt-3 grid gap-2">
          <li v-for="match in matches" :key="match.chunkId" class="rounded-xl border border-default bg-default p-3">
            <h3 class="text-lg">{{ match.title || 'Untitled' }}</h3>
            <p v-if="match.author || match.createdAt" class="mt-0.5 text-sm text-muted">
              <span v-if="match.author">{{ match.author }}</span><span v-if="match.author && match.createdAt"> · </span><span v-if="match.createdAt">{{ match.createdAt.slice(0, 10) }}</span>
            </p>
            <p class="mt-2 leading-normal break-words whitespace-pre-wrap">{{ match.content || 'Passage unavailable.' }}</p>
            <UButton v-if="match.documentId" class="mt-2" color="neutral" variant="outline" label="Open document" @click="openDocument(match.documentId)" />
          </li>
        </ol>
        <UCard v-if="openedId && detailError" as="article" class="mt-4">
          <h2 class="text-2xl">{{ openedMatch?.title || 'Document' }}</h2>
          <ErrorState
            :error="detailError"
            title="Couldn’t open this document"
            :retrying="detailAsyncStatus === 'loading'"
            @retry="retryDetail()"
            @dismiss="openedId = null"
          />
        </UCard>
        <UCard v-else-if="openedId && detailPending" as="article" class="mt-4" aria-busy="true">
          <h2 class="text-2xl">{{ openedMatch?.title || 'Opening document' }}</h2>
          <p v-if="openedMatch?.author" class="text-sm text-muted">{{ openedMatch.author }}</p>
          <p role="status" class="sr-only">Opening {{ openedMatch?.title || 'document' }}…</p>
          <DocBodySkeleton />
        </UCard>
        <UCard v-else-if="openedId && selected" as="article" class="mt-4">
          <DocumentView :document="selected" />
        </UCard>
      </template>
    </section>
  </main>
</template>
