<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { LocationQueryRaw } from 'vue-router'
import { useDeleteDocumentMutation } from '~/mutations/documents'
import { documentFacetsQuery, documentListQuery, documentPath, type DocumentPage, type FacetValue } from '~/queries/documents'
import { LIBRARY_PAGE_SIZES, formatFileSize, hasActiveLibraryFilters, libraryRouteQuery, parseLibraryQuery, type LibraryFilters } from '~/utils/libraryFilters'

// Old links (/library?document=<id>, cited in earlier Claude answers) open the
// document's own page. 301 on a full page load, a replace on client navigation.
definePageMeta({
  middleware: [(to) => {
    const id = to.query.document
    if (typeof id === 'string' && id) return navigateTo(documentPath(id), { redirectCode: 301, replace: true })
  }]
})

const request = useRequestFetch()
const route = useRoute()
const router = useRouter()

// Search, filters, sort, and page all live in the URL; see utils/libraryFilters.ts.
const filters = computed(() => parseLibraryQuery(route.query))
const filtersActive = computed(() => hasActiveLibraryFilters(filters.value))

function routeQueryFor (next: LibraryFilters): LocationQueryRaw {
  return libraryRouteQuery(next)
}

// Any change except paging starts again from page 1. Filter edits replace the
// history entry; the address bar still updates, but Back skips each keystroke.
function updateFilters (patch: Partial<LibraryFilters>) {
  return router.replace({ query: routeQueryFor({ ...filters.value, page: 1, ...patch }) })
}

const pageLink = (page: number) => ({ query: routeQueryFor({ ...filters.value, page }) })

// The search box filters as you type, once typing pauses. Enter applies at once.
const SEARCH_DEBOUNCE_MS = 300
const searchInput = ref(filters.value.q)
let searchTimer: ReturnType<typeof setTimeout> | undefined
const normalizeSearch = (value: string) => value.trim().replace(/\s+/g, ' ')
function applySearch () {
  clearTimeout(searchTimer)
  const q = normalizeSearch(searchInput.value)
  if (q !== filters.value.q) updateFilters({ q })
}
watch(searchInput, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(applySearch, SEARCH_DEBOUNCE_MS)
})
// Back/forward or a pasted link changes the URL; mirror it in the box.
watch(() => filters.value.q, (q) => {
  if (normalizeSearch(searchInput.value) !== q) searchInput.value = q
})
onBeforeUnmount(() => clearTimeout(searchTimer))

function clearSearch () {
  searchInput.value = ''
  applySearch()
}

function clearFilters () {
  searchInput.value = ''
  clearTimeout(searchTimer)
  updateFilters({ q: '', author: '', uploadedBy: '', from: '', to: '' })
}

const inputValue = (event: Event) => (event.target as HTMLInputElement | HTMLSelectElement).value

// The list renders on the server for a full page load. While the next page or
// filter loads, the previous results stay on screen (dimmed) instead of
// flashing back to placeholders. Placeholders show only on the very first visit.
const {
  data: listPage,
  error: listError,
  asyncStatus: listAsyncStatus,
  isPlaceholderData,
  refetch: retryList
} = useQuery(() => ({
  ...documentListQuery({ filters: filters.value, request }),
  placeholderData: (previous: DocumentPage | undefined) => previous
}))
const documents = computed(() => listPage.value?.documents)
const loadingList = computed(() => listAsyncStatus.value === 'loading')
const refreshing = computed(() => loadingList.value && !!listPage.value)

const { data: facets } = useQuery(() => documentFacetsQuery(request))
// Keep the chosen name selectable even if its last document was deleted.
function withCurrent (list: FacetValue[] | undefined, current: string): FacetValue[] {
  const values = list ?? []
  if (current && !values.some(value => value.name === current)) return [{ name: current, count: 0 }, ...values]
  return values
}
const authorOptions = computed(() => withCurrent(facets.value?.authors, filters.value.author))
const uploaderOptions = computed(() => withCurrent(facets.value?.uploaders, filters.value.uploadedBy))

const rangeLabel = computed(() => {
  const page = listPage.value
  if (!page || page.total === 0 || !page.documents.length) return ''
  const start = (page.page - 1) * page.pageSize + 1
  const end = start + page.documents.length - 1
  const noun = page.total === 1 ? 'document' : 'documents'
  return `${start}–${end} of ${page.total} ${noun}${filtersActive.value ? ' matching' : ''}`
})

// Past the last page (a document was deleted, or a stale link): go to the last real page.
// Immediate, so a server-rendered out-of-range page is corrected after hydration too.
watch(listPage, (page) => {
  if (!import.meta.client || !page || isPlaceholderData.value) return
  if (page.totalPages > 0 && filters.value.page > page.totalPages) {
    router.replace({ query: routeQueryFor({ ...filters.value, page: page.totalPages }) })
  }
}, { immediate: true, flush: 'post' })

// Paging from the bottom of a long list: bring the top of the list back into view.
const listCard = ref<HTMLElement | null>(null)
watch(() => filters.value.page, () => {
  const card = listCard.value
  if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

// Optimistic: the row disappears at once and comes back if the server refuses.
const {
  mutateAsync: deleteDocument,
  error: deleteError,
  variables: deleteId,
  isLoading: deleting,
  reset: dismissDeleteError
} = useDeleteDocumentMutation()
const deleteTitle = computed(() => documents.value?.find(document => document.id === deleteId.value)?.title)

async function removeDocument (id: string, { confirmFirst = true } = {}) {
  if (confirmFirst && !confirm('Delete this document and its vectors?')) return
  // The error is shown from `deleteError`; nothing else to do here.
  await deleteDocument(id).catch(() => {})
}
</script>

<template>
  <main class="archive-page">
    <ArchiveEye />
    <p class="eyebrow">Company records</p>
    <h1>Library</h1>
    <section ref="listCard" class="card library-card" :aria-busy="loadingList">
      <form class="library-toolbar" role="search" aria-label="Find documents" @submit.prevent="applySearch">
        <div class="search-bar">
          <label class="sr-only" for="library-query">Search by title, author, file name, or uploader</label>
          <input
            id="library-query"
            v-model="searchInput"
            type="search"
            name="q"
            maxlength="200"
            autocomplete="off"
            enterkeyhint="search"
            placeholder="Search title, author, or file name…"
          >
          <button v-if="searchInput" class="clear-search" type="button" aria-label="Clear search" title="Clear search" @click="clearSearch">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
              <path d="m6 6 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            </svg>
          </button>
          <button class="search-submit" type="submit" aria-label="Search" title="Search">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="2" />
              <path d="m15 15 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>

        <div class="library-filters">
          <label>
            Author
            <select name="author" :value="filters.author" @change="updateFilters({ author: inputValue($event) })">
              <option value="">Any author</option>
              <option v-for="author in authorOptions" :key="author.name" :value="author.name">
                {{ author.name }}{{ author.count ? ` (${author.count})` : '' }}
              </option>
            </select>
          </label>
          <label v-if="uploaderOptions.length">
            Uploaded by
            <select name="uploader" :value="filters.uploadedBy" @change="updateFilters({ uploadedBy: inputValue($event) })">
              <option value="">Anyone</option>
              <option v-for="uploader in uploaderOptions" :key="uploader.name" :value="uploader.name">
                {{ uploader.name }}{{ uploader.count ? ` (${uploader.count})` : '' }}
              </option>
            </select>
          </label>
          <label>
            Sort by
            <select name="sort" :value="filters.sort" @change="updateFilters({ sort: inputValue($event) as LibraryFilters['sort'] })">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
          <label>
            Uploaded from
            <input type="date" name="from" :value="filters.from" :max="filters.to || undefined" @change="updateFilters({ from: inputValue($event) })">
          </label>
          <label>
            Uploaded to
            <input type="date" name="to" :value="filters.to" :min="filters.from || undefined" @change="updateFilters({ to: inputValue($event) })">
          </label>
        </div>
        <p class="meta search-filter-note">
          Matches words in the title, author, file name, or uploader, accents optional. Dates are in UTC.
          <button v-if="filtersActive" class="clear-filters" type="button" @click="clearFilters">Clear search and filters</button>
        </p>
      </form>

      <div class="library-summary">
        <p role="status" aria-live="polite" class="note library-status">
          <template v-if="!listPage && !listError">Loading documents…</template>
          <template v-else-if="refreshing && isPlaceholderData">Updating results…</template>
          <template v-else-if="refreshing">Checking for new documents…</template>
          <template v-else>{{ rangeLabel }}</template>
        </p>
        <label v-if="listPage && listPage.total > LIBRARY_PAGE_SIZES[0]" class="page-size">
          Per page
          <select name="size" :value="filters.pageSize" @change="updateFilters({ pageSize: Number(inputValue($event)) })">
            <option v-for="size in LIBRARY_PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
          </select>
        </label>
      </div>

      <ErrorState
        v-if="listError"
        :error="listError"
        :title="listPage ? 'Couldn’t refresh the list' : 'Couldn’t load the library'"
        :compact="!!listPage"
        :retrying="loadingList"
        @retry="retryList()"
      />

      <DocListSkeleton v-if="!listPage && !listError" />
      <div v-else-if="listPage && !listPage.total && filtersActive" class="empty-state">
        <p class="note">No documents match these filters.</p>
        <button class="ghost" type="button" @click="clearFilters">Clear search and filters</button>
      </div>
      <div v-else-if="listPage && !listPage.total" class="empty-state">
        <p class="note">No documents yet.</p>
        <NuxtLink class="ghost button-link" to="/feed">Add the first document</NuxtLink>
      </div>
      <template v-else-if="documents">
        <ul class="doc-list" :class="{ 'is-stale': isPlaceholderData }">
          <li v-for="document in documents" :key="document.id">
            <div>
              <NuxtLink class="doc-link" :to="documentPath(document.id)">{{ document.title }}</NuxtLink>
              <p class="meta">
                <span v-if="document.author">{{ document.author }} · </span>
                <time :datetime="document.createdAt">{{ document.createdAt.slice(0, 10) }}</time>
              </p>
              <p v-if="document.fileName || document.uploadedBy" class="meta doc-provenance">
                <span v-if="document.fileName" class="doc-file" :title="document.fileName">{{ document.fileName }}</span>
                <span v-if="document.fileName && document.fileSize !== null && document.fileSize !== undefined"> · {{ formatFileSize(document.fileSize) }}</span>
                <span v-if="document.uploadedBy">{{ document.fileName ? ' · ' : '' }}uploaded by {{ document.uploadedBy }}</span>
              </p>
            </div>
            <button class="danger" type="button" :aria-label="`Delete ${document.title}`" @click="removeDocument(document.id)">Delete</button>
          </li>
        </ul>
        <LibraryPagination :page="filters.page" :total-pages="listPage?.totalPages ?? 0" :link-for="pageLink" />
      </template>
      <ErrorState
        v-if="deleteError && deleteId"
        :error="deleteError"
        :title="deleteTitle ? `Couldn’t delete “${deleteTitle}”` : 'Couldn’t delete the document'"
        compact
        :retrying="deleting"
        @retry="removeDocument(deleteId, { confirmFirst: false })"
        @dismiss="dismissDeleteError()"
      />
    </section>

  </main>
</template>

<style scoped>
.doc-list.is-stale { opacity: 0.55; transition: opacity 120ms ease-in; }
.doc-list li > div { min-width: 0; }
.doc-provenance { overflow-wrap: anywhere; }
</style>
