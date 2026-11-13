<script setup lang="ts">
import { useSaveDocumentMutation } from '~/mutations/documents'

// PDF, Word, Excel, and CSV files are sent as-is and converted to text on the server.
const CONVERTIBLE = /\.(pdf|docx|xlsx|xlsm|xlsb|xls|csv)$/i
const TEXT = /\.(md|markdown|txt)$/i
const TEXT_MAX_BYTES = 250_000
const FILE_MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.xlsx,.xlsm,.xlsb,.xls,.csv,text/plain,text/markdown,application/pdf,text/csv'

const title = ref('')
const author = ref('')
const body = ref('')
const convertFile = ref<File | null>(null)
// Saving invalidates the cached Library list, so it shows the new document.
const { mutateAsync: saveNewDocument, isLoading: saving, error: saveError, reset: dismissSaveError } = useSaveDocumentMutation()
const saveMessage = ref('')
// Problems with the picked file, caught before anything is sent.
const fileError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function clearFile () {
  convertFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function onFile (event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  convertFile.value = null
  fileError.value = ''
  if (!file) return
  if (CONVERTIBLE.test(file.name)) {
    if (file.size > FILE_MAX_BYTES) {
      fileError.value = 'File is larger than 10 MB. Split it first.'
      input.value = ''
      return
    }
    convertFile.value = file
    if (!title.value.trim()) title.value = file.name.replace(CONVERTIBLE, '')
    return
  }
  if (file.size > TEXT_MAX_BYTES) {
    fileError.value = 'File is larger than the v1 limit (about 200k characters). Split it first.'
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    body.value = String(reader.result || '')
    if (!title.value.trim()) title.value = file.name.replace(TEXT, '')
  }
  reader.onerror = () => {
    fileError.value = 'Couldn’t read that file. Try saving it as plain text first.'
  }
  reader.readAsText(file)
}

function requestBody () {
  if (!convertFile.value) return { title: title.value, author: author.value, body: body.value }
  const form = new FormData()
  form.append('title', title.value)
  form.append('author', author.value)
  form.append('file', convertFile.value)
  return form
}

async function saveDocument () {
  if (saving.value) return
  saveMessage.value = ''
  fileError.value = ''
  try {
    const saved = await saveNewDocument(requestBody())
    saveMessage.value = `Saved “${saved.title}” to the archive.`
    title.value = ''
    author.value = ''
    body.value = ''
    clearFile()
  } catch {
    // Shown from `saveError`. The form keeps its contents so nothing is lost.
  }
}
</script>

<template>
  <main class="archive-page">
    <ArchiveEye />
    <p class="eyebrow">Records intake</p>
    <h1>Add a document</h1>
    <form class="card" @submit.prevent="saveDocument">

          <label>
            Title
            <input v-model="title" type="text" name="title" maxlength="200" required placeholder="Runbook title">
          </label>
          <label>
            Author
            <input v-model="author" type="text" name="author" maxlength="200" placeholder="Optional">
          </label>
          <label>
            Body
            <textarea
              v-model="body"
              name="body"
              :required="!convertFile"
              :disabled="Boolean(convertFile)"
              :placeholder="convertFile ? `Text will be extracted from ${convertFile.name} on save` : 'Paste markdown or plain text'"
            />
          </label>
          <label>
            Or upload .md / .txt / .pdf / .docx / .xlsx / .csv
            <input ref="fileInput" type="file" :accept="ACCEPT" @change="onFile">
          </label>
          <p v-if="convertFile" class="row">
            <span>{{ convertFile.name }} will be converted to text on save.</span>
            <button class="ghost" type="button" @click="clearFile">Remove file</button>
          </p>
          <div class="row">
            <button class="primary" type="submit" :disabled="saving">
              {{ saving ? (convertFile ? 'Converting and saving…' : 'Saving…') : 'Save document' }}
            </button>
          </div>
          <p v-if="saveMessage" class="ok" role="status">
            {{ saveMessage }} <NuxtLink to="/library">View in the Library</NuxtLink>
          </p>
          <p v-if="fileError" class="err" role="alert">{{ fileError }}</p>
          <ErrorState
            v-if="saveError"
            :error="saveError"
            title="Couldn’t save the document"
            :retrying="saving"
            @retry="saveDocument()"
            @dismiss="dismissSaveError()"
          />
        </form>
  </main>
</template>
