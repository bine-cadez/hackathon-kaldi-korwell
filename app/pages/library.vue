<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { useDeleteDocumentMutation } from '~/mutations/documents'
import { documentByIdQuery, documentListQuery } from '~/queries/documents'

const request = useRequestFetch()

// The list renders on the server for a full page load. On client navigation the
// page shows at once: cached data immediately (refreshed in the background when
// stale), or placeholders on the very first visit.
const { data: documents, error: listError, asyncStatus: listAsyncStatus, refetch: retryList } = useQuery(() => documentListQuery(request))
const refreshing = computed(() => listAsyncStatus.value === 'loading' && !!documents.value)

// /library?document=<id> opens that document. The upload page redirects here
// after a save, and chat answers and MCP search results cite this URL.
const route = useRoute()
const queryDocumentId = () => typeof route.query.document === 'string' && route.query.document ? route.query.document : null
const selectedId = ref<string | null>(queryDocumentId())
watch(queryDocumentId, (id) => { if (id) selectedId.value = id })
const { data: selected, error: detailError, isPending: detailPending, asyncStatus: detailAsyncStatus, refetch: retryDetail } = useQuery(() => ({
  ...documentByIdQuery({ id: selectedId.value ?? '', request }),
  enabled: !!selectedId.value
}))
const selectedSummary = computed(() => documents.value?.find(document => document.id === selectedId.value))

// Bring a document opened from the URL into view; it renders below the list.
const detailCard = ref<HTMLElement | null>(null)
let scrollPending = !!selectedId.value
watch(selected, async (doc) => {
  if (!import.meta.client || !scrollPending || !doc || doc.id !== queryDocumentId()) return
  scrollPending = false
  await nextTick()
  detailCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}, { immediate: true, flush: 'post' })
watch(queryDocumentId, (id) => { if (id) scrollPending = true })

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
  if (selectedId.value === id) selectedId.value = null
  // The error is shown from `deleteError`; nothing else to do here.
  await deleteDocument(id).catch(() => {})
}
</script>

<template>
  <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-16">
    <ArchiveEye class="mx-0 w-32" />
    <PageHeading eyebrow="Company records" title="Library" />
    <UCard as="section" :aria-busy="listAsyncStatus === 'loading'">
      <p role="status" :class="refreshing ? 'm-0 text-sm text-muted' : 'sr-only'">
        <template v-if="!documents && !listError">Loading documents…</template>
        <template v-else-if="refreshing">Checking for new documents…</template>
      </p>

      <ErrorState
        v-if="listError"
        :error="listError"
        :title="documents ? 'Couldn’t refresh the list' : 'Couldn’t load the library'"
        :compact="!!documents"
        :retrying="listAsyncStatus === 'loading'"
        @retry="retryList()"
      />

      <DocListSkeleton v-if="!documents && !listError" />
      <UEmpty
        v-else-if="documents && !documents.length"
        icon="i-lucide-archive"
        description="No documents yet."
        :actions="[{ label: 'Add the first document', to: '/feed', icon: 'i-lucide-plus' }]"
        variant="naked"
      />
      <ul v-else-if="documents" class="mt-3 grid gap-2">
        <li
          v-for="document in documents"
          :key="document.id"
          class="flex items-center justify-between gap-3 rounded-xl border p-3"
          :class="selectedId === document.id ? 'border-primary bg-kaldi-50' : 'border-default'"
        >
          <div class="min-w-0">
            <button
              class="text-start font-semibold text-primary hover:underline aria-busy:cursor-progress aria-busy:opacity-70"
              :class="{ 'font-bold underline': selectedId === document.id }"
              type="button"
              :aria-busy="selectedId === document.id && detailPending"
              @click="selectedId = document.id"
            >
              {{ document.title }}
            </button>
            <p v-if="document.author" class="mt-0.5 text-sm text-muted">{{ document.author }}</p>
            <DocumentProvenance :created-at="document.createdAt" :uploaded-by="document.uploadedBy" :source="document.source" />
          </div>
          <UButton color="error" variant="outline" icon="i-lucide-trash-2" label="Delete" @click="removeDocument(document.id)" />
        </li>
      </ul>
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

    <UCard v-if="selectedId && detailError" as="article" class="mt-4">
      <h2 class="text-2xl">{{ selectedSummary?.title ?? 'Document' }}</h2>
      <ErrorState
        :error="detailError"
        title="Couldn’t open this document"
        :retrying="detailAsyncStatus === 'loading'"
        @retry="retryDetail()"
        @dismiss="selectedId = null"
      />
    </UCard>
    <template v-else-if="selectedId">
      <div v-if="selected" ref="detailCard" class="mt-4 scroll-mt-4">
        <UCard as="article">
          <DocumentView :document="selected" />
        </UCard>
      </div>
      <UCard v-else as="article" class="mt-4" aria-busy="true">
        <h2 class="text-2xl">{{ selectedSummary?.title ?? 'Opening document' }}</h2>
        <p v-if="selectedSummary?.author" class="text-sm text-muted">{{ selectedSummary.author }}</p>
        <p role="status" class="sr-only">Opening {{ selectedSummary?.title ?? 'document' }}…</p>
        <DocBodySkeleton />
      </UCard>
    </template>
  </main>
</template>
