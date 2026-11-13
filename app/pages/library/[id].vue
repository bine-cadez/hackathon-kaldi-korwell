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

</script>

<template>
  <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-16">
    <!-- A plain link, so goBack can use history and modified clicks open a new tab. -->
    <NuxtLink
      class="mb-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline hover:underline-offset-[0.2em] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      to="/library"
      @click="goBack"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4" /> {{ back.label }}
    </NuxtLink>

    <template v-if="error && !document">
      <h1 class="text-4xl leading-tight [overflow-wrap:anywhere]">{{ summary?.title ?? 'Document' }}</h1>
      <UCard as="section" class="mt-5">
        <ErrorState
          :error="error"
          title="Couldn’t open this document"
          :retrying="asyncStatus === 'loading'"
          @retry="refetch()"
        />
        <UButton class="mt-3" color="neutral" variant="outline" icon="i-lucide-library" label="Browse the Library" to="/library" />
      </UCard>
    </template>

    <template v-else-if="document">
      <div class="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div class="min-w-0">
          <p class="eyebrow">Document</p>
          <h1 class="mt-1 text-4xl leading-tight [overflow-wrap:anywhere]">{{ document.title }}</h1>
        </div>
        <UButton
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          :loading="deleting"
          :label="deleting ? 'Deleting…' : 'Delete'"
          @click="removeDocument()"
        />
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

      <UCard as="section" class="mt-5" aria-label="Details">
        <dl class="m-0 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 text-sm [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted">
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
          <template v-if="document.source">
            <dt>Original</dt>
            <dd>
              <a class="text-primary underline underline-offset-[0.2em] [font-variant-ligatures:none]" :href="document.source.url" download>{{ document.source.filename }}</a>
              <span v-if="document.source.size !== null" class="text-muted"> · {{ formatFileSize(document.source.size) }}</span>
            </dd>
          </template>
        </dl>
      </UCard>

      <UCard as="article" class="mt-4" aria-label="Document text">
        <pre class="m-0 font-sans leading-normal break-words whitespace-pre-wrap">{{ document.body }}</pre>
      </UCard>
    </template>

    <template v-else-if="isPending">
      <p class="eyebrow">Document</p>
      <h1 v-if="summary" class="mt-1 text-4xl leading-tight [overflow-wrap:anywhere]">{{ summary.title }}</h1>
      <USkeleton v-else class="mt-2 mb-5 h-9 w-3/5 rounded-full bg-accented" aria-hidden="true" />
      <p v-if="summary?.author" class="mt-1 text-sm text-muted">{{ summary.author }}</p>
      <UCard as="article" class="mt-4" aria-busy="true">
        <p role="status" class="sr-only">Opening {{ summary?.title ?? 'document' }}…</p>
        <DocBodySkeleton />
      </UCard>
    </template>
  </main>
</template>
