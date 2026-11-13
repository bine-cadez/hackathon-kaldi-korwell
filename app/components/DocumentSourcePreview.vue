<script setup lang="ts">
import type { DocumentSource } from '~/queries/documents'
import { csvPreview, sourcePreviewKind, spreadsheetPreview, type PreviewSheet } from '~/utils/sourcePreview'

// The original uploaded file, as the person would see it in its own app:
// PDFs in the browser's viewer, CSV and Excel as tables.
const props = defineProps<{ source: DocumentSource }>()

const kind = computed(() => sourcePreviewKind(props.source.filename))
const inlineUrl = computed(() => `${props.source.url}?inline=1`)

const sheets = ref<PreviewSheet[]>([])
const activeSheet = ref(0)
const loading = ref(false)
const error = ref<Error | null>(null)

async function loadTable () {
  if (kind.value !== 'csv' && kind.value !== 'spreadsheet') return
  loading.value = true
  error.value = null
  try {
    const buffer = await $fetch<ArrayBuffer>(props.source.url, { responseType: 'arrayBuffer' })
    const bytes = new Uint8Array(buffer)
    sheets.value = kind.value === 'csv' ? [csvPreview(bytes, props.source.filename)] : await spreadsheetPreview(bytes)
    activeSheet.value = 0
  } catch (cause) {
    sheets.value = []
    error.value = cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    loading.value = false
  }
}

// The file is fetched by the browser only. The server render shows the skeleton.
onMounted(() => {
  watch(() => props.source.url, loadTable, { immediate: true })
})

const sheetTabs = computed(() => sheets.value.map((sheet, index) => ({ label: sheet.name, value: index })))
</script>

<template>
  <div>
    <template v-if="kind === 'pdf'">
      <iframe
        :src="inlineUrl"
        :title="`Preview of ${source.filename}`"
        class="h-[80vh] w-full rounded-lg border border-default bg-muted"
      />
      <p class="mt-2 text-sm text-muted">
        PDF not showing?
        <a :href="inlineUrl" target="_blank" rel="noopener" class="text-link underline underline-offset-[0.2em]">Open it in a new tab</a>.
      </p>
    </template>

    <template v-else-if="kind">
      <ErrorState
        v-if="error"
        :error="error"
        title="Couldn’t open the original file"
        compact
        :retrying="loading"
        @retry="loadTable()"
      />
      <div v-else-if="loading || !sheets.length" role="status" aria-label="Loading preview" class="space-y-2">
        <USkeleton v-for="row in 8" :key="row" class="h-7 w-full bg-accented" />
      </div>
      <template v-else>
        <UTabs
          v-if="sheets.length > 1"
          v-model="activeSheet"
          :items="sheetTabs"
          :content="false"
          variant="link"
          size="sm"
          class="mb-3"
        />
        <SpreadsheetTable :sheet="sheets[activeSheet]!" />
      </template>
    </template>
  </div>
</template>
