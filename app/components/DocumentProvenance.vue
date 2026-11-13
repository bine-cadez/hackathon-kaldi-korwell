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
  <p v-if="uploaded || source" class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
    <span v-if="uploaded">{{ uploaded }}</span>
    <a v-if="source" class="text-primary underline underline-offset-[0.2em]" :href="source.url" download>{{ size ? `Original: ${source.filename} (${size})` : `Original: ${source.filename}` }}</a>
  </p>
</template>

