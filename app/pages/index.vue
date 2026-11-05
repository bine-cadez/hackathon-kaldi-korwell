<script setup lang="ts">
interface Health {
  ok: boolean
  auth?: 'open' | 'password' | 'none'
  embeddingModel: string
  dimensions: number
  vectorBackend: 'd1' | 'vectorize'
  bindings: { db: boolean, vectorize: boolean, blob: boolean }
}

interface LibraryDocument {
  id: string
  title: string
  createdAt: string
  r2Key: string | null
  chunkCount: number
}

interface SearchMatch {
  chunkId: string
  documentId: string
  title: string
  chunkIndex: number
  content: string
  score: number
}

interface DocumentDetail {
  id: string
  title: string
  body: string
  createdAt: string
  r2Key: string | null
  chunks: Array<{ id: string, chunkIndex: number, content: string }>
}

const requestHeaders = useRequestHeaders(['cookie'])
const { data: health } = await useFetch<Health>('/api/health')
const { data: library, refresh: refreshLibrary } = await useFetch<{ documents: LibraryDocument[] }>('/api/documents', {
  headers: requestHeaders
})

const title = ref('')
const body = ref('')
const saving = ref(false)
const saveMessage = ref('')
const saveError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const query = ref('')
const searching = ref(false)
const searchError = ref('')
const matches = ref<SearchMatch[]>([])

const selected = ref<DocumentDetail | null>(null)
const detailError = ref('')

function errorMessage (error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as {
      data?: { message?: string, statusMessage?: string, data?: { message?: string } }
      statusMessage?: string
      message?: string
    }
    return record.data?.message
      || record.data?.data?.message
      || record.data?.statusMessage
      || record.statusMessage
      || record.message
      || 'Request failed'
  }
  return 'Request failed'
}

function onFile (event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 250_000) {
    saveError.value = 'File is larger than the v1 limit (about 200k characters). Split it first.'
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    body.value = String(reader.result || '')
    if (!title.value.trim()) title.value = file.name.replace(/\.(md|markdown|txt)$/i, '')
    saveError.value = ''
  }
  reader.readAsText(file)
}

async function saveDocument () {
  saving.value = true
  saveMessage.value = ''
  saveError.value = ''
  try {
    const saved = await $fetch<{ title: string, chunkCount: number, r2Key: string | null }>('/api/documents', {
      method: 'POST',
      body: { title: title.value, body: body.value }
    })
    saveMessage.value = `Saved “${saved.title}” as ${saved.chunkCount} chunk${saved.chunkCount === 1 ? '' : 's'}. Search can lag a few seconds while Vectorize indexes the new vectors.`
    title.value = ''
    body.value = ''
    if (fileInput.value) fileInput.value.value = ''
    await refreshLibrary()
  } catch (error) {
    saveError.value = errorMessage(error)
  } finally {
    saving.value = false
  }
}

async function runSearch () {
  searching.value = true
  searchError.value = ''
  try {
    const result = await $fetch<{ matches: SearchMatch[] }>('/api/search', {
      method: 'POST',
      body: { query: query.value, topK: 5 }
    })
    matches.value = result.matches
  } catch (error) {
    matches.value = []
    searchError.value = errorMessage(error)
  } finally {
    searching.value = false
  }
}

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

function formatScore (score: number) {
  return score.toFixed(3)
}
</script>

<template>
  <main class="shell">
    <header class="top">
      <div>
        <h1>Document library</h1>
        <p class="lede">
          Paste or upload a note. On save, the app chunks it, embeds each chunk with OpenRouter, and stores the text in D1 plus the vectors in Vectorize.
        </p>
      </div>
      <p v-if="health" class="meta">
        {{ health.embeddingModel }} · {{ health.dimensions }}d
      </p>
    </header>

    <p v-if="health?.auth === 'password'" class="banner">
      <strong>Shared password.</strong>
      This browser is unlocked. Upload and search still require the <code>site_auth</code> cookie. API clients send <code>Authorization: Bearer</code> or <code>X-Site-Password</code>. Cloudflare Access can replace this gate later.
    </p>
    <p v-else class="banner">
      <strong>Unlocked.</strong>
      <code>SITE_PASSWORD</code> is empty, so anyone who can open this URL can upload and search. Set the Worker secret before sharing it. Embeddings run only when someone saves a document.
    </p>

    <p v-if="health?.vectorBackend === 'd1'" class="banner">
      Local dev stores chunk vectors on the D1 chunk row and ranks them in the Worker. Wrangler has no local Vectorize simulator. Deployed search uses the Vectorize index. Set <code>VECTORIZE_REMOTE=true</code> to write the remote index from dev.
    </p>

    <p v-if="health && !health.ok" class="banner err">
      D1 or Vectorize is not bound
      (db {{ health.bindings.db ? 'yes' : 'no' }},
      vectorize {{ health.bindings.vectorize ? 'yes' : 'no' }},
      r2 {{ health.bindings.blob ? 'yes' : 'no' }}).
      Local dev needs the cloudflare_module preset and wrangler.jsonc.
    </p>

    <div class="layout">
      <section class="stack">
        <form class="card" @submit.prevent="saveDocument">
          <h2>Add a document</h2>
          <label>
            Title
            <input v-model="title" type="text" name="title" maxlength="200" required placeholder="Runbook title">
          </label>
          <label>
            Body
            <textarea v-model="body" name="body" required placeholder="Paste markdown or plain text" />
          </label>
          <label>
            Or upload .md / .txt
            <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" @change="onFile">
          </label>
          <div class="row">
            <button class="primary" type="submit" :disabled="saving">
              {{ saving ? 'Embedding…' : 'Save and embed' }}
            </button>
          </div>
          <p v-if="saveMessage" class="ok">{{ saveMessage }}</p>
          <p v-if="saveError" class="err">{{ saveError }}</p>
        </form>

        <section class="card">
          <h2>Library</h2>
          <p v-if="!library?.documents?.length" class="note">No documents yet.</p>
          <ul v-else class="doc-list">
            <li v-for="document in library.documents" :key="document.id">
              <div>
                <button class="link" type="button" @click="openDocument(document.id)">
                  {{ document.title }}
                </button>
                <div class="meta">{{ document.chunkCount }} chunks</div>
              </div>
              <button class="danger" type="button" @click="removeDocument(document.id)">Delete</button>
            </li>
          </ul>
          <p v-if="detailError" class="err">{{ detailError }}</p>
        </section>
      </section>

      <section class="stack">
        <form class="card search" @submit.prevent="runSearch">
          <h2>Search</h2>
          <label>
            Query
            <input v-model="query" type="text" name="query" required placeholder="What should I look up?">
          </label>
          <div class="row">
            <button class="primary" type="submit" :disabled="searching">
              {{ searching ? 'Searching…' : 'Search chunks' }}
            </button>
          </div>
          <p v-if="searchError" class="err">{{ searchError }}</p>
          <p v-else-if="matches.length === 0" class="note">Matches show the source document title and the chunk text.</p>
          <ol v-else class="results">
            <li v-for="match in matches" :key="match.chunkId" class="result">
              <div class="row" style="justify-content: space-between;">
                <h3>{{ match.title || 'Untitled' }}</h3>
                <span class="score">{{ formatScore(match.score) }}</span>
              </div>
              <p class="meta">Chunk {{ match.chunkIndex + 1 }}</p>
              <p class="chunk">{{ match.content || 'Chunk text was not found in D1.' }}</p>
              <button v-if="match.documentId" class="ghost" type="button" @click="openDocument(match.documentId)">
                Open source
              </button>
            </li>
          </ol>
        </form>

        <article v-if="selected" class="card">
          <h2>{{ selected.title }}</h2>
          <p class="meta">
            {{ selected.chunks.length }} chunks
            <template v-if="selected.r2Key"> · raw file in R2</template>
          </p>
          <pre class="body">{{ selected.body }}</pre>
        </article>
      </section>
    </div>
  </main>
</template>
