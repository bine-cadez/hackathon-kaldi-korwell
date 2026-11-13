<script setup lang="ts">
import { decodeTextBytes, type DetectedEncoding } from '#shared/utils/text'
import { useSaveDocumentMutation } from '~/mutations/documents'
import { documentPath } from '~/queries/documents'

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
const replayIntro = computed(() => rewardsEnabled && route.query.intro === 'replay')
const rewards = ref<{ colorSavedDocument: (wordCount: number) => Promise<void>, ending: boolean } | null>(null)
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
const { mutateAsync: saveNewDocument, isLoading: uploading, error: saveError, reset: dismissSaveError } = useSaveDocumentMutation()
const openingLibrary = ref(false)
const saving = computed(() => uploading.value || openingLibrary.value)
const uploadLocked = computed(() => saving.value || Boolean(rewards.value?.ending))
let leaving = false
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
// A text file picked into the body. It is uploaded too, so its original is kept.
const pickedFile = ref<File | null>(null)
// Set when a text file was not UTF-8 (e.g. Windows-1250 from Excel) and was converted.
const pickedEncoding = ref<DetectedEncoding | null>(null)
const LEGACY_ENCODING_LABELS: Partial<Record<DetectedEncoding, string>> = {
  'windows-1250': 'Windows-1250',
  'iso-8859-2': 'ISO-8859-2',
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16'
}
const encodingNote = computed(() => {
  const label = pickedEncoding.value && LEGACY_ENCODING_LABELS[pickedEncoding.value]
  return label ? `Read as ${label} and converted to UTF-8, so č, š and ž are kept.` : ''
})
// Title filled in from the last file, so picking another file can replace it
// without overwriting a title the person typed.
let autoTitle = ''

function clearFile () {
  if (pickedIsText.value) body.value = ''
  if (title.value === autoTitle) title.value = ''
  convertFile.value = null
  pickedName.value = ''
  pickedIsText.value = false
  pickedFile.value = null
  pickedEncoding.value = null
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
    pickedFile.value = null
    pickedEncoding.value = null
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
  // Read the bytes, not readAsText: that assumes UTF-8 and turns a Windows-1250
  // "č" into "�". decodeTextBytes detects the encoding first.
  file.arrayBuffer().then((buffer) => {
    const { text, encoding } = decodeTextBytes(new Uint8Array(buffer))
    convertFile.value = null
    body.value = text
    pickedName.value = file.name
    pickedIsText.value = true
    pickedFile.value = file
    pickedEncoding.value = encoding
    setTitleFrom(file.name.replace(TEXT, ''))
  }, () => {
    fileError.value = 'Couldn’t read that file. Try saving it as plain text first.'
  })
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
  if (event.dataTransfer) event.dataTransfer.dropEffect = uploadLocked.value ? 'none' : 'copy'
}

function onDragLeave (event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth.value = 0
  if (uploadLocked.value) return
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
  leaving = true
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})

function requestBody () {
  const textFile = pickedIsText.value ? pickedFile.value : null
  const file = convertFile.value ?? textFile
  if (!file) return { title: title.value, author: author.value, body: body.value }
  const form = new FormData()
  form.append('title', title.value)
  form.append('author', author.value)
  // A text file's (possibly edited) text is in the body; the server keeps the
  // file only as the original. Converted files get their text on the server.
  if (textFile) form.append('body', body.value)
  // Its own field, so names with ";" or "=" reach the server intact.
  form.append('fileName', file.name)
  form.append('file', file)
  return form
}

async function saveDocument () {
  if (uploadLocked.value) return
  saveMessage.value = ''
  fileError.value = ''
  try {
    const saved = await saveNewDocument(requestBody())
    if (leaving) return
    openingLibrary.value = true
    saveMessage.value = `Saved “${saved.title}” to the archive.`
    await rewards.value?.colorSavedDocument(saved.wordCount)
    if (leaving) return
    // Open the new document's page (the Library list is already invalidated).
    await navigateTo(documentPath(saved.id))
  } catch {
    // Shown from `saveError`. The form keeps its contents so nothing is lost.
  } finally {
    openingLibrary.value = false
  }
}
</script>

<template>
  <main class="relative isolate flex flex-col overflow-clip">
    <div class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-6">
      <div ref="feedEye" class="feed-heading">
        <ArchiveEye
          class="mx-0 w-32"
          :class="{ 'feed-eye-travelling': eyeTravel }"
          :style="eyeMotionStyle"
          :black-hole="eyeBlackHole"
        />
        <PageHeading eyebrow="Records intake" title="Add a document" />
      </div>
      <form
        ref="uploadForm"
        class="grid gap-4 rounded-2xl bg-default p-4 shadow-xs ring ring-default transition-opacity duration-[1100ms] ease-in-out motion-reduce:transition-none sm:p-6"
        :class="{ 'opacity-0': formHidden }"
        :style="eyeTravel ? { transitionDuration: eyeTravel.duration + 'ms' } : undefined"
        :inert="formHidden"
        @submit.prevent="saveDocument"
      >
        <UFormField label="Title" required>
          <UInput v-model="title" name="title" maxlength="200" required placeholder="Runbook title" class="w-full" />
        </UFormField>
        <UFormField label="Author">
          <UInput v-model="author" name="author" maxlength="200" placeholder="Optional" class="w-full" />
        </UFormField>
        <UFormField label="Body" :required="!convertFile">
          <UTextarea
            v-model="body"
            name="body"
            :rows="10"
            autoresize
            :maxrows="24"
            class="w-full"
            :required="!convertFile"
            :disabled="Boolean(convertFile)"
            :placeholder="convertFile ? `Text will be extracted from ${convertFile.name} on save` : 'Paste markdown or plain text'"
          />
        </UFormField>
        <label
          class="relative grid cursor-pointer justify-items-center gap-1 rounded-xl border-2 p-6 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
          :class="dragging
            ? 'border-solid border-orange bg-orange/10'
            : pickedName
              ? 'border-solid border-success bg-success/5'
              : 'border-dashed border-default hover:border-primary hover:bg-primary/5'"
        >
          <!-- Visually hidden but still focusable, so keyboard users can open the picker. -->
          <input ref="fileInput" class="pointer-events-none absolute size-px opacity-0" type="file" :accept="ACCEPT" :disabled="uploadLocked" @change="onFile">
          <UIcon :name="pickedName && !dragging ? 'i-lucide-file-check' : 'i-lucide-upload'" class="size-6" :class="pickedName && !dragging ? 'text-success' : 'text-primary'" />
          <template v-if="dragging">
            <strong>{{ pickedName ? 'Drop to replace the file' : 'Drop to add this file' }}</strong>
            <span class="text-sm text-muted">{{ ACCEPT_LABEL }} · up to 10 MB</span>
          </template>
          <template v-else-if="pickedName">
            <strong class="text-success">{{ pickedName }} added</strong>
            <span class="text-sm text-muted">
              {{ pickedIsText ? 'Its text is in the body above.' : 'It is converted to text when you save.' }}
              <template v-if="encodingNote">{{ encodingNote }}</template>
              Drop or click to choose a different file.
            </span>
          </template>
          <template v-else>
            <strong>Drag a file here, or click to choose</strong>
            <span class="text-sm text-muted">{{ ACCEPT_LABEL }} · up to 10 MB</span>
          </template>
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            type="submit"
            size="lg"
            :loading="saving"
            :disabled="uploadLocked"
            :label="openingLibrary ? 'Opening Library…' : uploading ? (convertFile ? 'Converting and saving…' : 'Saving…') : 'Save document'"
          />
          <UButton v-if="pickedName" color="neutral" variant="outline" size="lg" icon="i-lucide-x" label="Remove file" :disabled="uploadLocked" @click="clearFile" />
        </div>
        <p v-if="saveMessage" class="m-0 text-success" role="status">{{ saveMessage }}</p>
        <UAlert v-if="fileError" role="alert" color="error" variant="subtle" icon="i-lucide-file-x" :title="fileError" />
        <UAlert
          v-if="duplicate"
          role="alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-copy"
          title="This document is already in the archive"
          :actions="[
            { label: 'Open existing document', color: 'neutral', variant: 'outline', size: 'sm', to: documentPath(duplicate.id) },
            { label: 'Dismiss', color: 'neutral', variant: 'link', size: 'sm', onClick: () => dismissSaveError() }
          ]"
          orientation="vertical"
          :ui="{ title: 'font-bold text-error', description: 'text-default opacity-100' }"
        >
          <template #description>
            It matches
            <NuxtLink class="font-semibold text-primary underline" :to="documentPath(duplicate.id)">“{{ duplicate.title }}”</NuxtLink><template v-if="duplicateDate">, added {{ duplicateDate }}</template>.
            Nothing was saved. Choose a different file, or open the existing one.
          </template>
        </UAlert>
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
    <ClientOnly>
      <PanemRewards
        :key="`${panemDemo}:${replayIntro}`"
        ref="rewards"
        :anchor="feedEye"
        :form="uploadForm"
        :rewards-enabled="rewardsEnabled"
        :saving="saving"
        :demo="panemDemo"
        :replay="replayIntro"
        @eye-travel="eyeTravel = $event"
        @eye-black-hole="eyeBlackHole = $event"
      />
    </ClientOnly>
  </main>
</template>

<style scoped>
/* The eye flies to the Panem rewards and back (PanemRewards.vue drives it). */
.feed-heading :deep(.feed-eye-travelling) {
  position: relative;
  z-index: 3;
  transform-origin: 52.0833% 46.6667%;
  transition-property: transform;
  transition-timing-function: ease-in-out;
}

/* Keep the heading readable while the eyes swarm behind it. */
.feed-heading :deep(:is(h1, .eyebrow)) {
  -webkit-text-stroke: 0.2em var(--paper);
  paint-order: stroke fill;
}
</style>
