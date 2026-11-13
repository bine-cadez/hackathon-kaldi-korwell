<script setup lang="ts">
import { documentPath } from '~/queries/documents'

// The reader side of the Library before a document is chosen. On narrow
// screens only the list shows (see pages/library.vue).
// Old links (/library?document=<id>, cited in earlier Claude answers) open the
// document's own page. 301 on a full page load, a replace on client navigation.
definePageMeta({
  middleware: [(to) => {
    const id = to.query.document
    if (typeof id === 'string' && id) return navigateTo(documentPath(id), { redirectCode: 301, replace: true })
  }]
})
</script>

<template>
  <section class="flex min-h-[32rem] flex-col items-center justify-center px-8 py-20 text-center lg:sticky lg:top-0 lg:h-dvh">
    <ArchiveEye class="w-40" />
    <h2 class="text-3xl font-light">Choose a document</h2>
    <p class="mt-2 max-w-sm text-muted">Pick one from the list to read it here, or add a new one.</p>
    <UButton class="mt-6 uppercase" color="neutral" variant="outline" to="/feed" icon="i-lucide-plus" label="Add document" />
  </section>
</template>
