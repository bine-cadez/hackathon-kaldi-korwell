<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { LocationQueryRaw } from 'vue-router'
import { documentFacetsQuery, documentListQuery, documentPath, type DocumentPage, type FacetValue } from '~/queries/documents'
import { LIBRARY_PAGE_SIZES, hasActiveLibraryFilters, libraryRouteQuery, parseLibraryQuery, type LibraryFilters } from '~/utils/libraryFilters'

// The Library is a split view: this page is the list on the left, and the
// child page (library/index.vue or library/[id].vue) is the reader on the right.
// The list's search, filters, and page stay in the query string while a
// document is open, so opening one never resets the list.
useHead({ title: 'Library' })

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

const openId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const documentLink = (id: string) => ({ path: documentPath(id), query: route.query })

// Filters fold away under a button; it opens on its own when a filter is set.
const filterCount = computed(() => [filters.value.author, filters.value.uploadedBy, filters.value.from, filters.value.to].filter(Boolean).length)
const filtersOpen = ref(filterCount.value > 0)

// A new page of results starts at the top of the list.
const listPane = ref<HTMLElement | null>(null)
watch(() => filters.value.page, () => { listPane.value?.scrollTo({ top: 0 }) })
</script>
<template>
  <main class="grid lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
    <aside
      ref="listPane"
      class="flex-col border-default lg:sticky lg:top-0 lg:flex lg:max-h-dvh lg:self-start lg:overflow-y-auto lg:border-r"
      :class="openId ? 'hidden' : 'flex'"
      aria-label="Documents"
    >
      <div class="grid gap-3 px-[clamp(1rem,4vw,1.75rem)] pt-8 pb-4">
        <div>
          <p class="eyebrow">Library</p>
          <h1 class="mt-1 text-3xl font-light">
            <template v-if="listPage && !filtersActive">{{ listPage.total }} {{ listPage.total === 1 ? 'document' : 'documents' }}</template>
            <template v-else>Documents</template>
          </h1>
        </div>

        <form role="search" aria-label="Find documents" @submit.prevent="applySearch">
          <label class="sr-only" for="library-query">Search by title, author, file name, or uploader</label>
          <UInput
            id="library-query"
            v-model="searchInput"
            type="search"
            name="query"
            size="lg"
            class="w-full"
            icon="i-lucide-search"
            placeholder="Search title, author, or file"
            maxlength="200"
            autocomplete="off"
            enterkeyhint="search"
            :ui="{ base: 'bg-default [&::-webkit-search-cancel-button]:appearance-none', trailing: 'pe-1.5' }"
          >
            <template v-if="searchInput" #trailing>
              <UButton color="neutral" variant="link" size="sm" icon="i-lucide-x" aria-label="Clear search" title="Clear search" @click="clearSearch" />
            </template>
          </UInput>
        </form>

        <UCollapsible v-model:open="filtersOpen">
          <div class="flex items-center justify-between gap-2">
            <UButton
              color="neutral"
              variant="link"
              class="px-0"
              :trailing-icon="filtersOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :label="filterCount ? `Filters (${filterCount})` : 'Filters'"
            />
            <USelect
              :model-value="filters.sort"
              :items="sortItems"
              name="sort"
              size="sm"
              variant="ghost"
              aria-label="Sort by"
              @update:model-value="updateFilters({ sort: $event as LibraryFilters['sort'] })"
            />
          </div>
          <template #content>
            <div class="grid grid-cols-2 gap-x-3 gap-y-2.5 pt-2 pb-1 [&_label]:text-sm [&_label]:text-muted">
              <UFormField label="Author" class="col-span-2">
                <USelect
                  :model-value="filters.author || ANY"
                  :items="authorItems"
                  name="author"
                  class="w-full"
                  @update:model-value="updateFilters({ author: fromAny($event) })"
                />
              </UFormField>
              <UFormField v-if="uploaderOptions.length" label="Uploaded by" class="col-span-2">
                <USelect
                  :model-value="filters.uploadedBy || ANY"
                  :items="uploaderItems"
                  name="uploader"
                  class="w-full"
                  @update:model-value="updateFilters({ uploadedBy: fromAny($event) })"
                />
              </UFormField>
              <UFormField label="Uploaded from">
                <UInput type="date" name="from" class="w-full" :model-value="filters.from" :max="filters.to || undefined" @change="updateFilters({ from: inputValue($event) })" />
              </UFormField>
              <UFormField label="Uploaded to">
                <UInput type="date" name="to" class="w-full" :model-value="filters.to" :min="filters.from || undefined" @change="updateFilters({ to: inputValue($event) })" />
              </UFormField>
              <p class="col-span-2 m-0 text-sm text-muted">Matches words in the title, author, file name, or uploader, accents optional. Dates are in UTC.</p>
            </div>
          </template>
        </UCollapsible>
        <UButton v-if="filtersActive" class="justify-self-start px-0 text-link underline underline-offset-[0.2em]" variant="link" size="sm" label="Clear search and filters" @click="clearFilters" />

        <div class="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
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
              size="xs"
              variant="ghost"
              @update:model-value="updateFilters({ pageSize: Number($event) })"
            />
          </label>
        </div>
      </div>

      <div class="px-[clamp(1rem,4vw,1.75rem)]" :class="{ 'pb-4': listError }">
        <ErrorState
          v-if="listError"
          :error="listError"
          :title="listPage ? 'Couldn’t refresh the list' : 'Couldn’t load the library'"
          :compact="!!listPage"
          :retrying="loadingList"
          @retry="retryList()"
        />
      </div>

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
        <ul class="border-t border-default transition-opacity" :class="{ 'opacity-55': isPlaceholderData }">
          <li v-for="document in documents" :key="document.id" class="border-b border-default">
            <NuxtLink
              :to="documentLink(document.id)"
              class="relative block px-[clamp(1rem,4vw,1.75rem)] py-3.5 hover:bg-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              :class="{ 'bg-default before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary': document.id === openId }"
              :aria-current="document.id === openId ? 'page' : undefined"
            >
              <span class="block font-serif text-lg leading-snug font-medium [overflow-wrap:anywhere]">{{ document.title }}</span>
              <span class="mt-0.5 block text-sm text-muted">{{ [document.author, formatShortDate(document.createdAt)].filter(Boolean).join(', ') }}</span>
            </NuxtLink>
          </li>
        </ul>
        <LibraryPagination class="px-[clamp(1rem,4vw,1.75rem)] pb-6" compact :page="filters.page" :total-pages="listPage?.totalPages ?? 0" :link-for="pageLink" />
      </template>
    </aside>

    <div class="min-w-0" :class="openId ? '' : 'hidden lg:block'">
      <NuxtPage />
    </div>
  </main>
</template>
