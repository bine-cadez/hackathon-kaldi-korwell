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
  <main class="archive-page">
    <ArchiveEye />
    <p class="eyebrow">Company records</p>
    <h1>Library</h1>
    <section class="card" :aria-busy="listAsyncStatus === 'loading'">
      <p role="status" :class="refreshing ? 'note library-status' : 'sr-only'">
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
      <div v-else-if="documents && !documents.length" class="empty-state">
        <p class="note">No documents yet.</p>
        <NuxtLink class="ghost button-link" to="/feed">Add the first document</NuxtLink>
      </div>
      <ul v-else-if="documents" class="doc-list">
        <li v-for="document in documents" :key="document.id" :class="{ 'is-selected': selectedId === document.id }">
          <div>
            <button
              class="link"
              type="button"
              :aria-busy="selectedId === document.id && detailPending"
              @click="selectedId = document.id"
            >
              {{ document.title }}
            </button>
            <p v-if="document.author" class="meta">{{ document.author }}</p>
            <DocumentProvenance :created-at="document.createdAt" :uploaded-by="document.uploadedBy" :source="document.source" />
          </div>
          <button class="danger" type="button" @click="removeDocument(document.id)">Delete</button>
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
    </section>

    <article v-if="selectedId && detailError" class="card">
      <h2>{{ selectedSummary?.title ?? 'Document' }}</h2>
      <ErrorState
        :error="detailError"
        title="Couldn’t open this document"
        :retrying="detailAsyncStatus === 'loading'"
        @retry="retryDetail()"
        @dismiss="selectedId = null"
      />
    </article>
    <template v-else-if="selectedId">
      <article v-if="selected" ref="detailCard" class="card doc-detail">
        <h2>{{ selected.title }}</h2>
        <p v-if="selected.author" class="meta">{{ selected.author }}</p>
        <DocumentProvenance :created-at="selected.createdAt" :uploaded-by="selected.uploadedBy" :source="selected.source" />
        <pre class="body">{{ selected.body }}</pre>
      </article>
      <article v-else class="card" aria-busy="true">
        <h2>{{ selectedSummary?.title ?? 'Opening document' }}</h2>
        <p v-if="selectedSummary?.author" class="meta">{{ selectedSummary.author }}</p>
        <p role="status" class="sr-only">Opening {{ selectedSummary?.title ?? 'document' }}…</p>
        <DocBodySkeleton />
      </article>
    </template>
  </main>
</template>

<style scoped>
.doc-list li.is-selected .link { font-weight: 700; text-decoration: underline; }
.doc-detail { scroll-margin-top: 1rem; }
</style>
