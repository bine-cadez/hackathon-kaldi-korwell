<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { LocationQueryRaw } from 'vue-router'
import { useDeleteDocumentMutation } from '~/mutations/documents'
import { documentFacetsQuery, documentListQuery, documentPath, type DocumentPage, type FacetValue } from '~/queries/documents'
import { LIBRARY_PAGE_SIZES, hasActiveLibraryFilters, libraryRouteQuery, parseLibraryQuery, type LibraryFilters } from '~/utils/libraryFilters'

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

// Nuxt UI selects cannot use '' as an item value, so "any" stands for no filter.
const ANY = '__any__'
const facetItems = (anyLabel: string, values: FacetValue[]) => [
  { label: anyLabel, value: ANY },
  ...values.map(value => ({ label: value.count ? `${value.name} (${value.count})` : value.name, value: value.name }))
]
const authorItems = computed(() => facetItems('Any author', authorOptions.value))
const uploaderItems = computed(() => facetItems('Anyone', uploaderOptions.value))
const fromAny = (value: unknown) => (value === ANY || typeof value !== 'string' ? '' : value)
const sortItems = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Title A–Z', value: 'title' }
]
const pageSizeItems = LIBRARY_PAGE_SIZES.map((size): { label: string, value: number } => ({ label: String(size), value: size }))

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
  <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-16">
    <ArchiveEye class="mx-0 w-32" />
    <PageHeading eyebrow="Company records" title="Library" />
    <div ref="listCard" class="scroll-mt-4">
      <UCard as="section" :aria-busy="loadingList">
        <form class="grid gap-3" role="search" aria-label="Find documents" @submit.prevent="applySearch">
          <SearchBar
            v-model="searchInput"
            input-id="library-query"
            label="Search by title, author, file name, or uploader"
            placeholder="Search title, author, or file name…"
            clearable
            maxlength="200"
            autocomplete="off"
            enterkeyhint="search"
            @clear="clearSearch"
          />

          <div class="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 md:grid-cols-3 [&_label]:text-sm [&_label]:text-muted">
            <UFormField label="Author">
              <USelect
                :model-value="filters.author || ANY"
                :items="authorItems"
                name="author"
                class="w-full"
                @update:model-value="updateFilters({ author: fromAny($event) })"
              />
            </UFormField>
            <UFormField v-if="uploaderOptions.length" label="Uploaded by">
              <USelect
                :model-value="filters.uploadedBy || ANY"
                :items="uploaderItems"
                name="uploader"
                class="w-full"
                @update:model-value="updateFilters({ uploadedBy: fromAny($event) })"
              />
            </UFormField>
            <UFormField label="Sort by">
              <USelect
                :model-value="filters.sort"
                :items="sortItems"
                name="sort"
                class="w-full"
                @update:model-value="updateFilters({ sort: $event as LibraryFilters['sort'] })"
              />
            </UFormField>
            <UFormField label="Uploaded from">
              <UInput type="date" name="from" class="w-full" :model-value="filters.from" :max="filters.to || undefined" @change="updateFilters({ from: inputValue($event) })" />
            </UFormField>
            <UFormField label="Uploaded to">
              <UInput type="date" name="to" class="w-full" :model-value="filters.to" :min="filters.from || undefined" @change="updateFilters({ to: inputValue($event) })" />
            </UFormField>
          </div>
          <p class="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted">
            Matches words in the title, author, file name, or uploader, accents optional. Dates are in UTC.
            <UButton v-if="filtersActive" class="px-0 underline underline-offset-[0.2em]" variant="link" size="sm" label="Clear search and filters" @click="clearFilters" />
          </p>
        </form>

        <div class="mt-4 flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-default pt-3">
          <p role="status" aria-live="polite" class="m-0 text-sm text-muted tabular-nums">
            <template v-if="!listPage && !listError">Loading documents…</template>
            <template v-else-if="refreshing && isPlaceholderData">Updating results…</template>
            <template v-else-if="refreshing">Checking for new documents…</template>
            <template v-else>{{ rangeLabel }}</template>
          </p>
          <label v-if="listPage && listPage.total > LIBRARY_PAGE_SIZES[0]" class="flex items-center gap-2 text-sm text-muted">
            Per page
            <USelect
              :model-value="filters.pageSize"
              :items="pageSizeItems"
              name="size"
              size="sm"
              @update:model-value="updateFilters({ pageSize: Number($event) })"
            />
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
        <UEmpty
          v-else-if="listPage && !listPage.total && filtersActive"
          icon="i-lucide-search-x"
          description="No documents match these filters."
          :actions="[{ label: 'Clear search and filters', color: 'neutral', variant: 'outline', onClick: clearFilters }]"
          variant="naked"
        />
        <UEmpty
          v-else-if="listPage && !listPage.total"
          icon="i-lucide-archive"
          description="No documents yet."
          :actions="[{ label: 'Add the first document', to: '/feed', icon: 'i-lucide-plus' }]"
          variant="naked"
        />
        <template v-else-if="documents">
          <ul class="mt-3 grid gap-2 transition-opacity" :class="{ 'opacity-55': isPlaceholderData }">
            <li v-for="document in documents" :key="document.id" class="flex items-center justify-between gap-3 rounded-xl border border-default p-3">
              <div class="min-w-0">
                <NuxtLink class="font-semibold text-primary hover:underline hover:underline-offset-[0.2em]" :to="documentPath(document.id)">{{ document.title }}</NuxtLink>
                <p v-if="document.author" class="mt-0.5 text-sm text-muted">{{ document.author }}</p>
                <DocumentProvenance :created-at="document.createdAt" :uploaded-by="document.uploadedBy" :source="document.source" />
              </div>
              <UButton color="error" variant="outline" icon="i-lucide-trash-2" label="Delete" :aria-label="`Delete ${document.title}`" @click="removeDocument(document.id)" />
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
      </UCard>
    </div>
  </main>
</template>
