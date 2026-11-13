<script setup lang="ts">
import { useQuery, useQueryCache } from '@pinia/colada'
import { useDeleteDocumentMutation } from '~/mutations/documents'
import { DOCUMENT_QUERY_KEYS, documentByIdQuery, type DocumentPage, type LibraryDocument } from '~/queries/documents'
import { renderDocumentMarkdown } from '~/utils/documentMarkdown'
import { formatFileSize } from '~/utils/libraryFilters'
import { sourcePreviewKind } from '~/utils/sourcePreview'

// One page per document: /library/<id>, shown in the Library's reader pane.
// Linked from the list, from the upload form after a save, from Ask answers,
// and from MCP citations.
const route = useRoute()
const request = useRequestFetch()
const id = computed(() => String(route.params.id ?? ''))

const { data: document, error, isPending, asyncStatus, refetch } = useQuery(() => documentByIdQuery({ id: id.value, request }))

// While the body loads, show the title and author from the list the person
// clicked, so the reader never starts blank.
const queryCache = useQueryCache()
const summary = computed((): Pick<LibraryDocument, 'title' | 'author'> | null => {
  for (const entry of queryCache.getEntries({ key: DOCUMENT_QUERY_KEYS.lists })) {
    const found = (entry.state.value.data as DocumentPage | undefined)?.documents.find(doc => doc.id === id.value)
    if (found) return found
  }
  return null
})
const title = computed(() => document.value?.title ?? summary.value?.title ?? '')

useHead(() => ({ title: title.value ? `${title.value} · Library` : 'Document · Library' }))

// Back to the list keeps its search, filters, and page (they ride along in the query).
const libraryLink = computed(() => ({ path: '/library', query: route.query }))

const uploaded = computed(() => {
  const doc = document.value
  if (!doc) return ''
  return ['Uploaded', formatDateTime(doc.createdAt), doc.uploadedBy ? `by ${doc.uploadedBy}` : ''].filter(Boolean).join(' ')
})
const fileLabel = computed(() => {
  const source = document.value?.source
  if (!source) return ''
  const size = formatFileSize(source.size)
  return size ? `${source.filename}, ${size}` : source.filename
})

const bodyHtml = computed(() => renderDocumentMarkdown(document.value?.body ?? ''))

// PDFs, CSV, and Excel open on the original file. The extracted text (what
// search and Ask see) is one tab away. Other documents show only the text.
const hasPreview = computed(() => Boolean(sourcePreviewKind(document.value?.source?.filename)))
const view = ref<'original' | 'text'>('original')
const viewTabs = [
  { label: 'Original', value: 'original', icon: 'i-lucide-file' },
  { label: 'Extracted text', value: 'text', icon: 'i-lucide-text' }
]
watch(id, () => { view.value = 'original' })

const { mutateAsync: deleteDocument, error: deleteError, isLoading: deleting, reset: dismissDeleteError } = useDeleteDocumentMutation()
async function removeDocument ({ confirmFirst = true } = {}) {
  if (confirmFirst && !confirm('Delete this document and its vectors?')) return
  try {
    await deleteDocument(id.value)
    await navigateTo(libraryLink.value, { replace: true })
  } catch {
    // Shown from `deleteError`.
  }
}
</script>

<template>
  <article class="px-[clamp(1rem,5vw,4.5rem)] pt-8 pb-16 lg:pt-10" :aria-busy="isPending">
    <NuxtLink
      class="mb-5 inline-flex items-center gap-1.5 rounded-sm text-sm text-link hover:underline hover:underline-offset-[0.2em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:hidden"
      :to="libraryLink"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4" /> Library
    </NuxtLink>

    <template v-if="error && !document">
      <h1 class="text-[clamp(2rem,4vw,2.8rem)] leading-tight [overflow-wrap:anywhere]">{{ summary?.title ?? 'Document' }}</h1>
      <div class="mt-6 max-w-2xl">
        <ErrorState
          :error="error"
          title="Couldn’t open this document"
          :retrying="asyncStatus === 'loading'"
          @retry="refetch()"
        />
      </div>
    </template>

    <template v-else-if="document">
      <h1 class="text-[clamp(2rem,4vw,2.8rem)] leading-tight [overflow-wrap:anywhere]">{{ document.title }}</h1>
      <p class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-muted">
        <span v-if="document.author">{{ document.author }}</span>
        <span>{{ uploaded }}</span>
        <span v-if="fileLabel" class="[overflow-wrap:anywhere]">{{ fileLabel }}</span>
      </p>
      <div class="mt-5 flex flex-wrap gap-2 border-b border-default pb-6">
        <UButton
          v-if="document.source"
          :to="document.source.url"
          external
          download
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-download"
          label="Download original"
          class="uppercase"
        />
        <UButton
          color="error"
          variant="outline"
          size="sm"
          icon="i-lucide-trash-2"
          class="uppercase"
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

      <UTabs
        v-if="hasPreview"
        v-model="view"
        :items="viewTabs"
        :content="false"
        variant="link"
        class="mt-4"
      />
      <DocumentSourcePreview v-if="hasPreview && view === 'original'" :source="document.source!" class="mt-6" />
      <!-- Escaped and link-checked by renderDocumentMarkdown, so v-html is safe here. -->
      <div v-else class="document-body mt-6 max-w-[42rem]" v-html="bodyHtml" />
    </template>

    <template v-else-if="isPending">
      <h1 v-if="summary" class="text-[clamp(2rem,4vw,2.8rem)] leading-tight [overflow-wrap:anywhere]">{{ summary.title }}</h1>
      <USkeleton v-else class="mb-5 h-10 w-3/5 rounded-full bg-accented" aria-hidden="true" />
      <p v-if="summary?.author" class="mt-3 text-muted">{{ summary.author }}</p>
      <p role="status" class="sr-only">Opening {{ summary?.title ?? 'document' }}…</p>
      <div class="mt-6 max-w-[42rem] border-t border-default pt-2">
        <DocBodySkeleton />
      </div>
    </template>
  </article>
</template>
