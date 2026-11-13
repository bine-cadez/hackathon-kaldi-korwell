<script setup lang="ts">
// Who uploaded a document, when, and a link to the file as it was uploaded.
const props = defineProps<{
  createdAt?: string | null
  uploadedBy?: string | null
  source?: { filename: string, size: number | null, url: string } | null
}>()

const uploadedAt = computed(() => {
  if (!props.createdAt) return ''
  const date = new Date(props.createdAt)
  if (Number.isNaN(date.getTime())) return props.createdAt
  return date.toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Ljubljana' })
})

const uploaded = computed(() => {
  if (!uploadedAt.value && !props.uploadedBy) return ''
  return ['Uploaded', uploadedAt.value, props.uploadedBy ? `by ${props.uploadedBy}` : ''].filter(Boolean).join(' ')
})

const size = computed(() => {
  const bytes = props.source?.size
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
})
</script>

<template>
  <p v-if="uploaded || source" class="meta provenance">
    <span v-if="uploaded">{{ uploaded }}</span>
    <a v-if="source" :href="source.url" download>{{ size ? `Original: ${source.filename} (${size})` : `Original: ${source.filename}` }}</a>
  </p>
</template>

<style scoped>
.provenance { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; font-size: 0.85rem; }
.provenance a { color: var(--accent); text-underline-offset: 0.2em; }
</style>
