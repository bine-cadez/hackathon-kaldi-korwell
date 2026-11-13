<script setup lang="ts">
import { useSaveDocumentMutation } from '~/mutations/documents'

const title = ref('')
const author = ref('')
const body = ref('')
// Saving invalidates the cached Library list, so it shows the new document.
const { mutateAsync: saveNewDocument, isLoading: saving, error: saveError, reset: dismissSaveError } = useSaveDocumentMutation()
const saveMessage = ref('')
// Problems with the picked file, caught before anything is sent.
const fileError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function onFile (event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 250_000) {
    fileError.value = 'File is larger than the v1 limit (about 200k characters). Split it first.'
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    body.value = String(reader.result || '')
    if (!title.value.trim()) title.value = file.name.replace(/\.(md|markdown|txt)$/i, '')
    fileError.value = ''
  }
  reader.onerror = () => {
    fileError.value = 'Couldn’t read that file. Try saving it as plain text first.'
  }
  reader.readAsText(file)
}

async function saveDocument () {
  if (saving.value) return
  saveMessage.value = ''
  fileError.value = ''
  try {
    const saved = await saveNewDocument({ title: title.value, author: author.value, body: body.value })
    saveMessage.value = `Saved “${saved.title}” to the archive.`
    title.value = ''
    author.value = ''
    body.value = ''
    if (fileInput.value) fileInput.value.value = ''
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
            <textarea v-model="body" name="body" required placeholder="Paste markdown or plain text" />
          </label>
          <label>
            Or upload .md / .txt
            <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" @change="onFile">
          </label>
          <div class="row">
            <button class="primary" type="submit" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save document' }}
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
