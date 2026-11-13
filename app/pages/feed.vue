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

// Upload files is the main way in; Paste text is the second tab.
const mode = ref<'upload' | 'paste'>('upload')
const modes = [
  { label: 'Upload files', value: 'upload', icon: 'i-lucide-upload' },
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

// Two or more files are saved as a batch: one request per file, one at a time,
// each its own document titled after its file. Every file keeps the server's
// per-request limits and gets its own result, so one bad file does not stop
// the rest. A single file uses the form below as before (editable title, and
// a text file's text under Paste text).
type BatchStatus = 'queued' | 'saving' | 'saved' | 'duplicate' | 'failed'
interface BatchItem {
  key: string
  file: File
  // Starts as the file name without its extension; editable until saved.
  title: string
  status: BatchStatus
  // The saved or matching document's title, or why the file failed.
  message: string
  documentId: string
}
const batch = ref<BatchItem[]>([])
const batchMode = computed(() => batch.value.length > 0)
const batchRunning = ref(false)
const batchStep = ref('')
const isPending = (item: BatchItem) => item.status === 'queued' || item.status === 'failed'
const batchPending = computed(() => batch.value.filter(isPending).length)
const batchFailed = computed(() => batch.value.filter(item => item.status === 'failed').length)
const BATCH_ICONS: Record<BatchStatus, string> = {
  queued: 'i-lucide-file',
  saving: 'i-lucide-loader-circle',
  saved: 'i-lucide-circle-check',
  duplicate: 'i-lucide-copy',
  failed: 'i-lucide-circle-alert'
}
const BATCH_COLORS: Record<BatchStatus, string> = {
  queued: 'text-muted',
  saving: 'text-primary animate-spin',
  saved: 'text-success',
  duplicate: 'text-warning',
  failed: 'text-error'
}

const saving = computed(() => uploading.value || openingLibrary.value || batchRunning.value)
const uploadLocked = computed(() => saving.value || Boolean(rewards.value?.ending))
let leaving = false
const saveMessage = ref('')
// A 409 means this content is already in the archive; shown as a warning with a link.
// A batch shows its errors per file instead.
const duplicate = computed(() => batchRunning.value ? null : duplicateOf(saveError.value))
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
watch(() => batch.value.length, (count, previous) => { if (count > previous) mainEye.value?.blink() })
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
// A text file still being read into the form. It already counts as attached,
// so a file added meanwhile joins it, and a stale read is dropped.
let readingFile: File | null = null

// Forgets the single attached file and whatever it filled into the form.
function clearSingle () {
  if (pickedIsText.value) body.value = ''
  if (title.value === autoTitle) title.value = ''
  convertFile.value = null
  pickedName.value = ''
  pickedIsText.value = false
  pickedFile.value = null
  pickedEncoding.value = null
  autoTitle = ''
  readingFile = null
}

function clearFile () {
  clearSingle()
  batch.value = []
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
  attachFiles(Array.from((event.target as HTMLInputElement).files || []))
}

function fileKey (file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

// Why a file can't be added, or '' when it can.
function fileProblem (file: File): string {
  if (CONVERTIBLE.test(file.name)) {
    return file.size > FILE_MAX_BYTES ? `${file.name} is larger than 10 MB. Split it first.` : ''
  }
  if (!TEXT.test(file.name) && !file.type.startsWith('text/')) {
    return `${file.name} is not a supported type. Upload ${ACCEPT_LABEL}.`
  }
  if (file.size > TEXT_MAX_BYTES) {
    return `${file.name} is larger than the v1 limit (about 200k characters). Split it first.`
  }
  return ''
}

// Shared by the file picker and drag-and-drop. Files are added to what is
// already attached; unsupported ones are skipped and named in the error.
function attachFiles (files: File[]) {
  resetInput()
  if (files.length === 0) return
  dismissSaveError()
  fileError.value = ''
  saveMessage.value = ''
  const single = convertFile.value ?? pickedFile.value ?? readingFile
  // Files from a finished batch are already in the archive, so they make way.
  const current = batchMode.value ? batch.value.filter(isPending).map(item => item.file) : single ? [single] : []
  const known = new Set(current.map(fileKey))
  const problems: string[] = []
  const added: File[] = []
  for (const file of files) {
    const problem = fileProblem(file)
    if (problem) problems.push(problem)
    else if (!known.has(fileKey(file))) {
      known.add(fileKey(file))
      added.push(file)
    }
  }
  fileError.value = problems.length > 1 ? `${problems.length} files were skipped. ${problems.join(' ')}` : problems[0] ?? ''
  if (added.length === 0) return

  const all = [...current, ...added]
  if (all.length === 1) {
    batch.value = []
    takeFile(all[0]!)
    return
  }
  // A title typed for the single file stays with that file in the list.
  const typedTitle = single && title.value.trim() && title.value !== autoTitle ? title.value.trim() : ''
  if (!batchMode.value) clearSingle()
  const previous = new Map(batch.value.map(item => [item.key, item]))
  batch.value = all.map(file => previous.get(fileKey(file)) ?? {
    key: fileKey(file),
    file,
    title: (file === single && typedTitle) || titleFromName(file.name),
    status: 'queued',
    message: '',
    documentId: ''
  })
}

function titleFromName (name: string) {
  return name.replace(CONVERTIBLE, '').replace(TEXT, '').trim().slice(0, 200)
}

function removeFromBatch (key: string) {
  const rest = batch.value.filter(item => item.key !== key)
  // Back to the single-file form when one unsaved file is left.
  if (rest.length === 1 && isPending(rest[0]!)) {
    batch.value = []
    takeFile(rest[0]!.file)
    return
  }
  batch.value = rest
}

// Attaches one already checked file to the form.
function takeFile (file: File) {
  readingFile = null
  if (CONVERTIBLE.test(file.name)) {
    if (pickedIsText.value) body.value = ''
    convertFile.value = file
    pickedName.value = file.name
    pickedIsText.value = false
    pickedFile.value = null
    pickedEncoding.value = null
    setTitleFrom(file.name.replace(CONVERTIBLE, ''))
    return
  }
  // Read the bytes, not readAsText: that assumes UTF-8 and turns a Windows-1250
  // "č" into "�". decodeTextBytes detects the encoding first.
  readingFile = file
  file.arrayBuffer().then((buffer) => {
    if (readingFile !== file) return
    readingFile = null
    const { text, encoding } = decodeTextBytes(new Uint8Array(buffer))
    convertFile.value = null
    body.value = text
    pickedName.value = file.name
    pickedIsText.value = true
    pickedFile.value = file
    pickedEncoding.value = encoding
    setTitleFrom(file.name.replace(TEXT, ''))
  }, () => {
    if (readingFile !== file) return
    readingFile = null
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
  attachFiles(Array.from(event.dataTransfer?.files || []))
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

function batchRequest ({ file, title }: BatchItem) {
  const form = new FormData()
  form.append('title', title.trim() || titleFromName(file.name))
  form.append('author', author.value)
  form.append('fileName', file.name)
  // No body: the server reads the text from every file, text files included.
  form.append('file', file)
  return form
}

function plural (count: number, word: string) {
  return `${count} ${count === 1 ? word : word + 's'}`
}

async function saveBatch () {
  const todo = batch.value.filter(isPending)
  if (todo.length === 0) return
  batchRunning.value = true
  let words = 0
  try {
    for (const [index, item] of todo.entries()) {
      if (leaving) return
      batchStep.value = `${index + 1} of ${todo.length}`
      item.status = 'saving'
      item.message = ''
      try {
        const saved = await saveNewDocument(batchRequest(item))
        Object.assign(item, { status: 'saved', message: saved.title, documentId: saved.id })
        words += saved.wordCount
      } catch (error) {
        const existing = duplicateOf(error)
        if (existing) {
          Object.assign(item, { status: 'duplicate', message: existing.title, documentId: existing.id })
          continue
        }
        Object.assign(item, { status: 'failed', message: errorMessage(error) })
        // Signed out: every other file would fail the same way.
        if (describeError(error).needsSignIn) break
      }
    }
  } finally {
    batchRunning.value = false
    // Results are shown per file, not in the single-document error block.
    dismissSaveError()
  }
  // Files left unsent after a sign-in failure go back in the queue.
  for (const item of todo) if (item.status === 'saving') item.status = 'queued'
  if (leaving) return

  const saved = todo.filter(item => item.status === 'saved').length
  const duplicates = todo.filter(item => item.status === 'duplicate').length
  const allSaved = batch.value.every(item => item.status === 'saved')
  saveMessage.value = allSaved
    ? `Saved ${plural(saved, 'document')} to the archive.`
    : [saved && `Saved ${saved} of ${plural(todo.length, 'file')}.`, duplicates && `${plural(duplicates, 'file')} already in the archive.`].filter(Boolean).join(' ')
  try {
    if (allSaved) openingLibrary.value = true
    await rewards.value?.colorSavedDocument(words)
    if (leaving || !allSaved) return
    // Newest first, so the new documents are at the top.
    await navigateTo('/library')
  } finally {
    openingLibrary.value = false
  }
}

async function saveDocument () {
  if (uploadLocked.value) return
  saveMessage.value = ''
  fileError.value = ''
  if (mode.value === 'upload' && batchMode.value) return saveBatch()
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

const saveLabel = computed(() => {
  if (openingLibrary.value) return 'Opening Library…'
  if (batchRunning.value) return `Saving ${batchStep.value}…`
  if (uploading.value) return convertFile.value ? 'Converting and saving…' : 'Saving…'
  if (mode.value === 'upload' && batchMode.value) return `Save ${plural(batchPending.value, 'document')}`
  return 'Save document'
})
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
            : pickedName || batchMode
              ? 'border-solid border-success'
              : 'border-dashed border-accented hover:border-primary'"
        >
          <!-- Visually hidden but still focusable, so keyboard users can open the picker. -->
          <input ref="fileInput" class="pointer-events-none absolute size-px opacity-0" type="file" multiple :accept="ACCEPT" :disabled="uploadLocked" @change="onFile">
          <UIcon :name="(pickedName || batchMode) && !dragging ? 'i-lucide-file-check' : 'i-lucide-upload'" class="size-9" :class="(pickedName || batchMode) && !dragging ? 'text-success' : 'text-primary'" />
          <template v-if="dragging">
            <strong class="font-serif text-2xl font-normal">{{ pickedName || batchMode ? 'Drop to add more files' : 'Drop to add' }}</strong>
            <span class="text-muted">{{ ACCEPT_LABEL }}, up to 10 MB each</span>
          </template>
          <template v-else-if="batchMode">
            <strong class="font-serif text-2xl font-normal text-success">{{ plural(batch.length, 'file') }} added</strong>
            <span class="max-w-md text-muted">
              Each becomes its own document. Click a title below to rename it. Drop or click here to add more.
            </span>
          </template>
          <template v-else-if="pickedName">
            <strong class="font-serif text-2xl font-normal [overflow-wrap:anywhere] text-success">{{ pickedName }} added</strong>
            <span class="max-w-md text-muted">
              {{ pickedIsText ? 'Its text is under Paste text, where you can edit it.' : 'Korwell converts it to text when you save.' }}
              <template v-if="encodingNote">{{ encodingNote }}</template>
              Drop or click to add more files.
            </span>
          </template>
          <template v-else>
            <strong class="font-serif text-2xl font-normal">Drop files here, or choose some</strong>
            <span class="text-muted">Each file becomes its own document. Up to 10 MB each.</span>
            <span class="mt-1 flex flex-wrap justify-center gap-1.5">
              <UBadge v-for="type in FILE_TYPES" :key="type" color="neutral" variant="soft" size="sm" class="rounded-full uppercase" :label="type" />
            </span>
          </template>
        </label>

        <ul v-if="mode === 'upload' && batchMode" class="m-0 grid list-none gap-1.5 p-0" aria-label="Files to save">
          <li v-for="item in batch" :key="item.key" class="flex items-start gap-3 rounded-2xl bg-default/85 px-4 py-2.5">
            <UIcon :name="BATCH_ICONS[item.status]" class="mt-0.5 size-5 shrink-0" :class="BATCH_COLORS[item.status]" />
            <div class="min-w-0 flex-1">
              <UInput
                v-if="isPending(item)"
                v-model="item.title"
                :name="`title-${item.key}`"
                :aria-label="`Title for ${item.file.name}`"
                maxlength="200"
                required
                variant="none"
                trailing-icon="i-lucide-pencil"
                class="-mx-2 w-[calc(100%+1rem)]"
                :ui="{ base: 'px-2 py-1 rounded-lg hover:bg-elevated focus:bg-elevated focus:ring-2 focus:ring-primary', trailingIcon: 'size-4 text-dimmed' }"
                :disabled="uploadLocked"
              />
              <p v-else class="m-0 [overflow-wrap:anywhere]">{{ item.title }}</p>
              <p class="m-0 text-xs text-muted [overflow-wrap:anywhere]">{{ item.file.name }}</p>
              <p v-if="item.status === 'saved'" class="m-0 text-sm text-muted">
                Saved as <NuxtLink class="text-link underline" :to="documentPath(item.documentId)">“{{ item.message }}”</NuxtLink>
              </p>
              <p v-else-if="item.status === 'duplicate'" class="m-0 text-sm text-muted">
                Already in the archive as <NuxtLink class="text-link underline" :to="documentPath(item.documentId)">“{{ item.message }}”</NuxtLink>. Not saved again.
              </p>
              <p v-else-if="item.status === 'failed'" class="m-0 text-sm text-error">{{ item.message }}</p>
            </div>
            <UButton
              v-if="isPending(item)"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-x"
              :aria-label="`Remove ${item.file.name}`"
              :disabled="uploadLocked"
              @click="removeFromBatch(item.key)"
            />
          </li>
        </ul>

        <UFormField v-if="mode === 'paste'" label="Body" :required="!convertFile">
          <UTextarea
            v-model="body"
            name="body"
            :rows="10"
            autoresize
            :maxrows="24"
            size="lg"
            class="w-full"
            :ui="{ base: 'px-5 py-4' }"
            :required="!convertFile"
            :disabled="Boolean(convertFile)"
            :placeholder="convertFile ? `Text will be extracted from ${convertFile.name} on save` : 'Paste markdown or plain text'"
          />
        </UFormField>

        <div class="grid gap-4" :class="{ 'sm:grid-cols-[1.4fr_1fr]': !(mode === 'upload' && batchMode) }">
          <UFormField v-if="!(mode === 'upload' && batchMode)" label="Title" required>
            <UInput v-model="title" name="title" maxlength="200" required placeholder="Runbook title" size="lg" class="w-full" />
          </UFormField>
          <UFormField label="Author" :description="mode === 'upload' && batchMode ? 'Used for every file.' : undefined">
            <UInput v-model="author" name="author" maxlength="200" placeholder="Optional" size="lg" class="w-full" />
          </UFormField>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-2">
          <!-- Every file in the batch is saved or already archived: nothing left to send. -->
          <UButton v-if="mode === 'upload' && batchMode && !batchPending && !saving" to="/library" size="xl" class="px-7 uppercase" label="Open Library" />
          <UButton
            v-else
            type="submit"
            size="xl"
            class="px-7 uppercase"
            :loading="saving"
            :disabled="uploadLocked"
            :label="saveLabel"
          />
          <UButton v-if="pickedName || batchMode" color="neutral" variant="outline" size="xl" icon="i-lucide-x" :label="batchMode ? 'Clear files' : 'Remove file'" :disabled="uploadLocked" @click="clearFile" />
        </div>
        <p v-if="saveMessage" class="m-0 text-center text-success" role="status">{{ saveMessage }}</p>
        <UAlert v-if="fileError" role="alert" color="error" variant="subtle" icon="i-lucide-file-x" :title="fileError" />
        <UAlert
          v-if="batchFailed && !batchRunning"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="batchFailed === 1 ? '1 file wasn’t saved' : `${batchFailed} files weren’t saved`"
          description="The reason is under each file. Remove them, or press Save to try again."
        />
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
          v-else-if="saveError && !batchRunning"
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
