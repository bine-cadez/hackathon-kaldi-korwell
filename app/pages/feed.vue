<script setup lang="ts">
import { useSaveDocumentMutation } from '~/mutations/documents'

// PDF, Word, Excel, and CSV files are sent as-is and converted to text on the server.
const CONVERTIBLE = /\.(pdf|docx|xlsx|xlsm|xlsb|xls|csv)$/i
const TEXT = /\.(md|markdown|txt)$/i
const TEXT_MAX_BYTES = 250_000
const FILE_MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.xlsx,.xlsm,.xlsb,.xls,.csv,text/plain,text/markdown,application/pdf,text/csv'
const ACCEPT_LABEL = '.md, .txt, .pdf, .docx, .xlsx, or .csv'

const route = useRoute()
const rewardsEnabled = import.meta.dev
const panemDemo = computed(() => rewardsEnabled && route.query.panem === '1')
const rewards = ref<{ creditDocument: (wordCount: number) => void } | null>(null)
const feedEye = ref<HTMLElement | null>(null)
const uploadForm = ref<HTMLFormElement | null>(null)
const eyeTravel = ref<{ x: number, y: number, scale: number, returning: boolean, duration: number } | null>(null)
const eyeBlackHole = ref(false)
const formHidden = computed(() => eyeTravel.value !== null && !eyeTravel.value.returning)
const eyeMotionStyle = computed(() => {
  const travel = eyeTravel.value
  if (!travel) return undefined
  const transform = travel.returning ? 'none' : `translate(${travel.x}px, ${travel.y}px) scale(${travel.scale})`
  return { transform, transitionDuration: travel.duration + 'ms' }
})

const title = ref('')
const author = ref('')
const body = ref('')
const convertFile = ref<File | null>(null)
// Saving invalidates the cached Library list, so it shows the new document.
const { mutateAsync: saveNewDocument, isLoading: saving, error: saveError, reset: dismissSaveError } = useSaveDocumentMutation()
const saveMessage = ref('')
// A 409 means this content is already in the archive; shown as a warning with a link.
const duplicate = computed(() => duplicateOf(saveError.value))
const duplicateDate = computed(() => {
  const date = duplicate.value?.createdAt ? new Date(duplicate.value.createdAt) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : ''
})
// Problems with the picked file, caught before anything is sent.
const fileError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// The file currently attached (by drop or picker). Nothing is uploaded until Save.
const pickedName = ref('')
const pickedIsText = ref(false)
// Title filled in from the last file, so picking another file can replace it
// without overwriting a title the person typed.
let autoTitle = ''

function clearFile () {
  if (pickedIsText.value) body.value = ''
  if (title.value === autoTitle) title.value = ''
  convertFile.value = null
  pickedName.value = ''
  pickedIsText.value = false
  autoTitle = ''
  resetInput()
}

function setTitleFrom (name: string) {
  if (title.value.trim() && title.value !== autoTitle) return
  title.value = name
  autoTitle = name
}

function resetInput () {
  if (fileInput.value) fileInput.value.value = ''
}

function onFile (event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) takeFile(file)
}

// Shared by the file picker and drag-and-drop.
function takeFile (file: File) {
  dismissSaveError()
  fileError.value = ''
  saveMessage.value = ''
  if (CONVERTIBLE.test(file.name)) {
    if (file.size > FILE_MAX_BYTES) {
      fileError.value = 'File is larger than 10 MB. Split it first.'
      resetInput()
      return
    }
    if (pickedIsText.value) body.value = ''
    convertFile.value = file
    pickedName.value = file.name
    pickedIsText.value = false
    setTitleFrom(file.name.replace(CONVERTIBLE, ''))
    return
  }
  if (!TEXT.test(file.name) && !file.type.startsWith('text/')) {
    fileError.value = `${file.name} is not a supported type. Upload ${ACCEPT_LABEL}.`
    resetInput()
    return
  }
  if (file.size > TEXT_MAX_BYTES) {
    fileError.value = 'File is larger than the v1 limit (about 200k characters). Split it first.'
    resetInput()
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    convertFile.value = null
    body.value = String(reader.result || '')
    pickedName.value = file.name
    pickedIsText.value = true
    setTitleFrom(file.name.replace(TEXT, ''))
  }
  reader.onerror = () => {
    fileError.value = 'Couldn’t read that file. Try saving it as plain text first.'
  }
  reader.readAsText(file)
}

// The whole page is a drop target, so a file dropped next to the zone (or on the
// textarea) is uploaded instead of the browser navigating away to open it.
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0)

function hasFiles (event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function onDragEnter (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth.value++
}

function onDragOver (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = saving.value || formHidden.value ? 'none' : 'copy'
}

function onDragLeave (event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth.value = 0
  if (saving.value || formHidden.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length === 0) return
  resetInput()
  takeFile(files[0]!)
  if (files.length > 1 && !fileError.value) {
    saveMessage.value = `Only one file per document. Using ${files[0]!.name}.`
  }
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})

function requestBody () {
  if (!convertFile.value) return { title: title.value, author: author.value, body: body.value }
  const form = new FormData()
  form.append('title', title.value)
  form.append('author', author.value)
  form.append('file', convertFile.value)
  return form
}

async function saveDocument () {
  if (saving.value || formHidden.value) return
  saveMessage.value = ''
  fileError.value = ''
  try {
    const saved = await saveNewDocument(requestBody())
    if (rewardsEnabled && !panemDemo.value && rewards.value) {
      rewards.value.creditDocument(saved.wordCount ?? 0)
      clearFile()
      title.value = ''
      author.value = ''
      body.value = ''
      saveMessage.value = `Saved “${saved.title}” to the archive.`
      return
    }
    // Open the new document in the Library (its list is already invalidated).
    await navigateTo({ path: '/library', query: { document: saved.id } })
  } catch {
    // Shown from `saveError`. The form keeps its contents so nothing is lost.
  }
}
</script>

<template>
  <main class="feed-page" :class="{ 'feed-with-rewards': rewardsEnabled }">
    <div class="archive-page">
      <div ref="feedEye" class="feed-heading">
        <ArchiveEye
          :class="{ 'feed-eye-travelling': eyeTravel }"
          :style="eyeMotionStyle"
          :black-hole="eyeBlackHole"
        />
        <p class="eyebrow">Records intake</p>
        <h1>Add a document</h1>
      </div>
      <form
        ref="uploadForm"
        class="card feed-form"
        :class="{ 'feed-form-hidden': formHidden }"
        :style="eyeTravel ? { transitionDuration: eyeTravel.duration + 'ms' } : undefined"
        :inert="formHidden"
        @submit.prevent="saveDocument"
      >
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
        <label class="dropzone" :class="{ 'is-dragging': dragging, 'has-file': pickedName && !dragging }">
          <input ref="fileInput" class="dropzone-input" type="file" :accept="ACCEPT" :disabled="saving" @change="onFile">
          <template v-if="dragging">
            <strong>{{ pickedName ? 'Drop to replace the file' : 'Drop to add this file' }}</strong>
            <span class="dropzone-hint">{{ ACCEPT_LABEL }} · up to 10 MB</span>
          </template>
          <template v-else-if="pickedName">
            <strong><span aria-hidden="true">✓ </span>{{ pickedName }} added</strong>
            <span class="dropzone-hint">
              {{ pickedIsText ? 'Its text is in the body above.' : 'It is converted to text when you save.' }}
              Drop or click to choose a different file.
            </span>
          </template>
          <template v-else>
            <strong>Drag a file here, or click to choose</strong>
            <span class="dropzone-hint">{{ ACCEPT_LABEL }} · up to 10 MB</span>
          </template>
        </label>
        <p v-if="pickedName" class="row">
          <button class="ghost" type="button" :disabled="saving" @click="clearFile">Remove file</button>
        </p>
        <div class="row">
          <button class="primary" type="submit" :disabled="saving">
            {{ saving ? (convertFile ? 'Converting and saving…' : 'Saving…') : 'Save document' }}
          </button>
        </div>
        <p v-if="saveMessage" class="ok" role="status">{{ saveMessage }}</p>
        <p v-if="fileError" class="err" role="alert">{{ fileError }}</p>
        <div v-if="duplicate" class="duplicate-warning" role="alert">
          <p class="duplicate-title">This document is already in the archive</p>
          <p>
            It matches
            <NuxtLink :to="{ path: '/library', query: { document: duplicate.id } }">“{{ duplicate.title }}”</NuxtLink><template v-if="duplicateDate">, added {{ duplicateDate }}</template>.
            Nothing was saved. Choose a different file, or open the existing one.
          </p>
          <div class="row">
            <NuxtLink class="ghost button-link" :to="{ path: '/library', query: { document: duplicate.id } }">Open existing document</NuxtLink>
            <button class="error-state-dismiss" type="button" @click="dismissSaveError()">Dismiss</button>
          </div>
        </div>
        <ErrorState
          v-else-if="saveError"
          :error="saveError"
          title="Couldn’t save the document"
          :retrying="saving"
          @retry="saveDocument()"
          @dismiss="dismissSaveError()"
        />
      </form>
    </div>
    <PanemRewards
      v-if="rewardsEnabled"
      :key="`${panemDemo}:${route.query.intro === 'replay'}`"
      ref="rewards"
      :anchor="feedEye"
      :form="uploadForm"
      :demo="panemDemo"
      :replay="route.query.intro === 'replay'"
      @eye-travel="eyeTravel = $event"
      @eye-black-hole="eyeBlackHole = $event"
    />
  </main>
</template>

<style scoped>
.duplicate-warning {
  display: grid;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border: 1px solid color-mix(in srgb, var(--brand-orange) 55%, var(--line));
  border-left-width: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--brand-orange) 8%, var(--card));
}

.duplicate-warning p { margin: 0; }

.duplicate-title { font-weight: 700; color: var(--warn); }

.duplicate-warning a:not(.button-link) { color: var(--accent); font-weight: 600; }

.dropzone {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 0.25rem;
  padding: 1.4rem 1rem;
  border: 2px dashed var(--line);
  border-radius: 12px;
  background: var(--card);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.dropzone:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, var(--card));
}

.dropzone.has-file {
  border-style: solid;
  border-color: var(--ok);
  background: color-mix(in srgb, var(--ok) 7%, var(--card));
}

.dropzone.has-file strong { color: var(--ok); }

.dropzone.is-dragging {
  border-style: solid;
  border-color: var(--brand-orange);
  background: color-mix(in srgb, var(--brand-orange) 10%, var(--card));
}

.dropzone:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Visually hidden but still focusable, so keyboard users can open the picker. */
.dropzone-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.dropzone-hint { color: var(--muted); font-size: 0.85rem; }

.feed-with-rewards {
  position: relative;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  min-height: calc(100svh - 4rem);
  overflow: clip;
}
.feed-with-rewards > .archive-page {
  margin-block: 0;
  padding-bottom: 1.5rem;
}
.feed-form {
  transition: opacity 1100ms ease-in-out;
}
.feed-form-hidden {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .feed-form { transition-property: none; }
}
.feed-heading :deep(.feed-eye-travelling) {
  position: relative;
  z-index: 3;
  transform-origin: 52.0833% 46.6667%;
  transition-property: transform;
  transition-timing-function: ease-in-out;
}
.feed-heading > h1 {
  line-height: 1.12;
  margin-bottom: 1.4rem;
}
.feed-with-rewards .feed-heading :is(h1, .eyebrow) {
  -webkit-text-stroke: 0.2em var(--paper);
  paint-order: stroke fill;
}
</style>
