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

useHead({ title: 'Add document' })

const route = useRoute()
const rewardsEnabled = import.meta.dev
const panemDemo = computed(() => rewardsEnabled && route.query.panem === '1')
const replayIntro = computed(() => rewardsEnabled && route.query.intro === 'replay')
const rewards = ref<{ colorSavedDocument: (wordCount: number) => Promise<void>, ending: boolean } | null>(null)
const feedEye = ref<HTMLElement | null>(null)
const uploadForm = ref<HTMLFormElement | null>(null)
const eyeTravel = ref<{ x: number, y: number, scale: number, returning: boolean, duration: number } | null>(null)
const eyeBlackHole = ref(false)
// The heading and the form fade out while the eye flies to the centre and
// swallows the small eyes, and stay hidden until the Wolt disc has landed
// (PanemRewards clears eyeTravel then). They fade out over the eye's flight
// and come back over 900ms.
const formHidden = computed(() => eyeTravel.value !== null)
const fadeStyle = computed(() => ({ transitionDuration: (formHidden.value ? eyeTravel.value!.duration : 900) + 'ms' }))
const eyeMotionStyle = computed(() => {
  const travel = eyeTravel.value
  if (!travel) return undefined
  const transform = travel.returning ? 'none' : `translate(${travel.x}px, ${travel.y}px) scale(${travel.scale})`
  return { transform, transitionDuration: travel.duration + 'ms' }
})

// Upload a file is the main way in; Paste text is the second tab.
const mode = ref<'upload' | 'paste'>('upload')
const modes = [
  { label: 'Upload a file', value: 'upload', icon: 'i-lucide-upload' },
  { label: 'Paste text', value: 'paste', icon: 'i-lucide-text' }
]
const FILE_TYPES = ['PDF', 'Word', 'Excel', 'CSV', 'Markdown', 'Text']

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
// The eye blinks once when a file is attached: noted.
watch(pickedName, (name) => { if (name) mainEye.value?.blink() })
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

// How the eye reacts to the upload: it locks onto a dragged file, reads while
// saving, is pleased once fed, and narrows at an error. The Panem finale drives
// the eye itself, so it has no mood then.
const mainEye = ref<{ lookAt: (clientX: number, clientY: number) => void, blink: () => void } | null>(null)
// How full the small eyes are (0 to 1), reported by PanemRewards.
const eyeAppetite = ref(0)
const eyeMood = computed(() => {
  if (eyeTravel.value || eyeBlackHole.value) return 'idle'
  if (uploading.value) return 'reading'
  if (openingLibrary.value) return 'pleased'
  if (dragging.value && !uploadLocked.value) return 'hungry'
  if (fileError.value || saveError.value) return 'alarmed'
  return 'idle'
})

function hasFiles (event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function onDragEnter (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth.value++
  // Show the drop area while a file is dragged over the page.
  if (!uploadLocked.value) mode.value = 'upload'
}

function onDragOver (event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = uploadLocked.value ? 'none' : 'copy'
  // Pointer events stop during a drag, so the eye follows the file from here.
  mainEye.value?.lookAt(event.clientX, event.clientY)
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
  if (mode.value === 'upload' && !convertFile.value && !pickedFile.value) {
    fileError.value = 'Choose a file first, or switch to Paste text.'
    return
  }
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
    <div class="mx-auto w-[min(44rem,calc(100%-2rem))] pt-12 pb-10">
      <div ref="feedEye" class="feed-heading text-center">
        <ArchiveEye
          ref="mainEye"
          class="w-44"
          :mood="eyeMood"
          :appetite="eyeAppetite"
          :class="{ 'feed-eye-travelling': eyeTravel }"
          :style="eyeMotionStyle"
          :black-hole="eyeBlackHole"
        />
        <div
          class="mx-auto w-fit rounded-[2rem] bg-paper/92 px-6 py-3 backdrop-blur-sm transition-opacity ease-in-out motion-reduce:transition-none"
          :class="{ 'opacity-0': formHidden }"
          :style="fadeStyle"
        >
          <h1 class="text-[clamp(2.2rem,5vw,2.9rem)] leading-tight font-light">Add a document</h1>
          <p class="mx-auto mt-2 max-w-md text-lg text-muted">Once it’s saved, anyone can ask Korwell about it.</p>
        </div>
      </div>
      <form
        ref="uploadForm"
        class="mt-8 grid gap-5 rounded-[2rem] bg-paper/92 p-[clamp(1rem,4vw,2rem)] shadow-[0_0_0_1px_rgb(89_61_20/0.08),0_24px_60px_-30px_rgb(89_61_20/0.35)] backdrop-blur-sm transition-opacity ease-in-out motion-reduce:transition-none"
        :class="{ 'opacity-0': formHidden }"
        :style="fadeStyle"
        :inert="formHidden"
        @submit.prevent="saveDocument"
      >
        <UTabs
          v-model="mode"
          :items="modes"
          :content="false"
          variant="link"
          class="justify-self-center"
          :ui="{ list: 'border-b-0', trigger: 'tracking-wide uppercase text-base px-0 mx-3' }"
        />

        <label
          v-show="mode === 'upload'"
          class="relative grid cursor-pointer justify-items-center gap-2 rounded-[1.75rem] border-2 bg-default/85 px-6 py-10 text-center backdrop-blur-[2px] transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
          :class="dragging
            ? 'border-solid border-orange bg-flame-50'
            : pickedName
              ? 'border-solid border-success'
              : 'border-dashed border-accented hover:border-primary'"
        >
          <!-- Visually hidden but still focusable, so keyboard users can open the picker. -->
          <input ref="fileInput" class="pointer-events-none absolute size-px opacity-0" type="file" :accept="ACCEPT" :disabled="uploadLocked" @change="onFile">
          <UIcon :name="pickedName && !dragging ? 'i-lucide-file-check' : 'i-lucide-upload'" class="size-9" :class="pickedName && !dragging ? 'text-success' : 'text-primary'" />
          <template v-if="dragging">
            <strong class="font-serif text-2xl font-normal">{{ pickedName ? 'Drop to replace the file' : 'Drop to add this file' }}</strong>
            <span class="text-muted">{{ ACCEPT_LABEL }}, up to 10 MB</span>
          </template>
          <template v-else-if="pickedName">
            <strong class="font-serif text-2xl font-normal [overflow-wrap:anywhere] text-success">{{ pickedName }} added</strong>
            <span class="max-w-md text-muted">
              {{ pickedIsText ? 'Its text is under Paste text, where you can edit it.' : 'Korwell converts it to text when you save.' }}
              <template v-if="encodingNote">{{ encodingNote }}</template>
              Drop or click to choose a different file.
            </span>
          </template>
          <template v-else>
            <strong class="font-serif text-2xl font-normal">Drop a file here, or choose one</strong>
            <span class="text-muted">Korwell converts it to text before saving. Up to 10 MB.</span>
            <span class="mt-1 flex flex-wrap justify-center gap-1.5">
              <UBadge v-for="type in FILE_TYPES" :key="type" color="neutral" variant="soft" size="sm" class="rounded-full uppercase" :label="type" />
            </span>
          </template>
        </label>

        <UFormField v-if="mode === 'paste'" label="Body" :required="!convertFile">
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

        <div class="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <UFormField label="Title" required>
            <UInput v-model="title" name="title" maxlength="200" required placeholder="Runbook title" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Author">
            <UInput v-model="author" name="author" maxlength="200" placeholder="Optional" size="lg" class="w-full" />
          </UFormField>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-2">
          <UButton
            type="submit"
            size="xl"
            class="px-7 uppercase"
            :loading="saving"
            :disabled="uploadLocked"
            :label="openingLibrary ? 'Opening Library…' : uploading ? (convertFile ? 'Converting and saving…' : 'Saving…') : 'Save document'"
          />
          <UButton v-if="pickedName" color="neutral" variant="outline" size="xl" icon="i-lucide-x" label="Remove file" :disabled="uploadLocked" @click="clearFile" />
        </div>
        <p v-if="saveMessage" class="m-0 text-center text-success" role="status">{{ saveMessage }}</p>
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
          :ui="{ title: 'font-semibold text-error', description: 'text-default opacity-100' }"
        >
          <template #description>
            It matches
            <NuxtLink class="font-semibold text-link underline" :to="documentPath(duplicate.id)">“{{ duplicate.title }}”</NuxtLink><template v-if="duplicateDate">, added {{ duplicateDate }}</template>.
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
        @appetite="eyeAppetite = $event"
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

</style>
