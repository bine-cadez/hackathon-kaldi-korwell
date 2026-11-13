<script setup lang="ts">
interface LibraryDocument {
  id: string
  title: string
  author?: string | null
  createdAt: string
  r2Key: string | null
  chunkCount: number
}

interface DocumentDetail {
  id: string
  title: string
  author?: string | null
  body: string
  createdAt: string
  r2Key: string | null
  chunks: Array<{ id: string, chunkIndex: number, content: string }>
}

const requestHeaders = useRequestHeaders(['cookie', 'cf-access-jwt-assertion'])
const { data: library, error: libraryError, refresh: refreshLibrary } = await useFetch<{ documents: LibraryDocument[] }>('/api/documents', {
  headers: requestHeaders
})

const selected = ref<DocumentDetail | null>(null)
const detailError = ref('')

async function openDocument (id: string) {
  detailError.value = ''
  try {
    selected.value = await $fetch<DocumentDetail>(`/api/documents/${id}`)
  } catch (error) {
    selected.value = null
    detailError.value = errorMessage(error)
  }
}

async function removeDocument (id: string) {
  if (!confirm('Delete this document and its vectors?')) return
  try {
    await $fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (selected.value?.id === id) selected.value = null
    await refreshLibrary()
  } catch (error) {
    detailError.value = errorMessage(error)
  }
}
</script>

<template>
  <main class="archive-page">
    <ArchiveEye />
    <p class="eyebrow">Company records</p>
    <h1>Library</h1>
    <section class="card">
          <p v-if="libraryError" class="err">{{ errorMessage(libraryError) }}</p>
          <p v-else-if="!library?.documents?.length" class="note">No documents yet.</p>
          <ul v-else class="doc-list">
            <li v-for="document in library.documents" :key="document.id">
              <div>
                <button class="link" type="button" @click="openDocument(document.id)">
                  {{ document.title }}
                </button>
                <p v-if="document.author" class="meta">{{ document.author }}</p>

              </div>
              <button class="danger" type="button" @click="removeDocument(document.id)">Delete</button>
            </li>
          </ul>
          <p v-if="detailError" class="err">{{ detailError }}</p>
    </section>
        <article v-if="selected" class="card">
          <h2>{{ selected.title }}</h2>
          <p v-if="selected.author" class="meta">{{ selected.author }}</p>
          <pre class="body">{{ selected.body }}</pre>
        </article>
  </main>
</template>
