<script setup lang="ts">
const title = ref('')
const body = ref('')
const saving = ref(false)
const saveMessage = ref('')
const saveError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

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
    saveMessage.value = `Saved “${saved.title}” to the archive.`
    title.value = ''
    body.value = ''
    if (fileInput.value) fileInput.value.value = ''
  } catch (error) {
    saveError.value = errorMessage(error)
  } finally {
    saving.value = false
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
          <p v-if="saveMessage" class="ok">{{ saveMessage }}</p>
          <p v-if="saveError" class="err">{{ saveError }}</p>
        </form>
  </main>
</template>
