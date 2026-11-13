<script setup lang="ts">
// A full document: title, author, provenance, and body text.
defineProps<{
  document: {
    title: string
    author?: string | null
    body: string
    createdAt?: string | null
    uploadedBy?: string | null
    source?: { filename: string, size: number | null, url: string } | null
  }
}>()
</script>

<template>
  <h2 class="text-2xl">{{ document.title }}</h2>
  <p v-if="document.author" class="mt-0.5 text-sm text-muted">{{ document.author }}</p>
  <DocumentProvenance :created-at="document.createdAt" :uploaded-by="document.uploadedBy" :source="document.source" />
  <pre class="mt-2 font-sans leading-normal break-words whitespace-pre-wrap">{{ document.body }}</pre>
</template>
