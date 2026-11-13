<script setup lang="ts">
import { useQuery, useQueryCache } from '@pinia/colada'
import { useDeleteDocumentMutation } from '~/mutations/documents'
import { DOCUMENT_QUERY_KEYS, SEARCH_QUERY_KEYS, documentByIdQuery, type DocumentPage, type LibraryDocument } from '~/queries/documents'
import { formatFileSize } from '~/utils/libraryFilters'

// One page per document: /library/<id>. Linked from the Library, search
// results, the upload form after a save, and MCP citations.
const route = useRoute()
const router = useRouter()
const request = useRequestFetch()
const id = computed(() => String(route.params.id ?? ''))

const { data: document, error, isPending, asyncStatus, refetch } = useQuery(() => documentByIdQuery({ id: id.value, request }))

// While the body loads, show the title and author from whichever list or
// search result the person clicked, so the page never starts blank.
const queryCache = useQueryCache()
const summary = computed((): Pick<LibraryDocument, 'title' | 'author'> | null => {
  for (const entry of queryCache.getEntries({ key: DOCUMENT_QUERY_KEYS.lists })) {
    const found = (entry.state.value.data as DocumentPage | undefined)?.documents.find(doc => doc.id === id.value)
    if (found) return found
  }
  for (const entry of queryCache.getEntries({ key: SEARCH_QUERY_KEYS.root })) {
    const matches = (entry.state.value.data as { matches?: Array<{ documentId: string, title: string, author?: string | null }> } | undefined)?.matches
    const found = matches?.find(match => match.documentId === id.value)
    if (found) return { title: found.title, author: found.author }
  }
  return null
})
const title = computed(() => document.value?.title ?? summary.value?.title ?? '')

useHead(() => ({ title: title.value ? `${title.value} · Library` : 'Document · Library' }))

// "Back" returns to wherever the person came from (search results or a filtered,
// paged Library view) with its state and scroll position. Opened directly, the
// link simply goes to the Library.
const back = ref<{ label: string, useHistory: boolean }>({ label: 'Library', useHistory: false })
onMounted(() => {
  const previous = router.options.history.state.back
  if (typeof previous !== 'string') return
  const path = previous.split('?')[0]
  if (path === '/library') back.value = { label: 'Library', useHistory: true }
  else if (path === '/' && previous.includes('?')) back.value = { label: 'Search results', useHistory: true }
})
function goBack (event: MouseEvent) {
  // Let modified clicks (new tab, new window) follow the plain link.
  if (!back.value.useHistory || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  router.back()
}

const { mutateAsync: deleteDocument, error: deleteError, isLoading: deleting, reset: dismissDeleteError } = useDeleteDocumentMutation()
async function removeDocument ({ confirmFirst = true } = {}) {
  if (confirmFirst && !confirm('Delete this document and its vectors?')) return
  try {
    await deleteDocument(id.value)
    await navigateTo('/library', { replace: true })
  } catch {
    // Shown from `deleteError`.
  }
}

const hasFileSize = computed(() => document.value?.fileSize !== null && document.value?.fileSize !== undefined)
</script>

<template>
  <main class="archive-page doc-page">
    <NuxtLink class="back-link" to="/library" @click="goBack">
      <span aria-hidden="true">←</span> {{ back.label }}
    </NuxtLink>

    <template v-if="error && !document">
      <h1>{{ summary?.title ?? 'Document' }}</h1>
      <section class="card">
        <ErrorState
          :error="error"
          title="Couldn’t open this document"
          :retrying="asyncStatus === 'loading'"
          @retry="refetch()"
        />
        <p class="row doc-error-actions">
          <NuxtLink class="button-link" to="/library">Browse the Library</NuxtLink>
        </p>
      </section>
    </template>

    <template v-else-if="document">
      <div class="doc-page-header">
        <div>
          <p class="eyebrow">Document</p>
          <h1>{{ document.title }}</h1>
        </div>
        <button class="danger" type="button" :disabled="deleting" @click="removeDocument()">
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
      </div>
      <ErrorState
        v-if="deleteError"
        :error="deleteError"
        title="Couldn’t delete this document"
        compact
        :retrying="deleting"
        @retry="removeDocument({ confirmFirst: false })"
        @dismiss="dismissDeleteError()"
      />

      <section class="card doc-details" aria-label="Details">
        <dl class="doc-facts">
          <template v-if="document.author">
            <dt>Author</dt>
            <dd>{{ document.author }}</dd>
          </template>
          <template v-if="document.uploadedBy">
            <dt>Uploaded by</dt>
            <dd>{{ document.uploadedBy }}</dd>
          </template>
          <dt>Uploaded</dt>
          <dd><time :datetime="document.createdAt">{{ document.createdAt.slice(0, 16).replace('T', ' ') }} UTC</time></dd>
          <template v-if="document.fileName">
            <dt>File</dt>
            <dd>
              <span class="doc-file">{{ document.fileName }}</span>
              <span v-if="hasFileSize" class="meta"> · {{ formatFileSize(document.fileSize) }}</span>
            </dd>
          </template>
        </dl>
      </section>

      <article class="card doc-body" aria-label="Document text">
        <pre class="body">{{ document.body }}</pre>
      </article>
    </template>

    <template v-else-if="isPending">
      <p class="eyebrow">Document</p>
      <h1 v-if="summary">{{ summary.title }}</h1>
      <span v-else class="skeleton skeleton-heading" aria-hidden="true" />
      <p v-if="summary?.author" class="meta">{{ summary.author }}</p>
      <article class="card doc-body" aria-busy="true">
        <p role="status" class="sr-only">Opening {{ summary?.title ?? 'document' }}…</p>
        <DocBodySkeleton />
      </article>
    </template>
  </main>
</template>
