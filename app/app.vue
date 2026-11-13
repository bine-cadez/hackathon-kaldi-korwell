<script setup lang="ts">
const accessEmail = useState<string | null>('korwell-access-email', () => {
  if (import.meta.server) return useRequestEvent()?.context.korwellAccessUser?.email ?? null
  return null
})

useHead({
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/korwell-eye.svg?v=2' }]
})
</script>

<template>
  <div class="archive-app">
    <NuxtRouteAnnouncer />
    <header class="archive-header">
      <NuxtLink class="archive-brand" to="/">The Kaldi Archive</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/chat">Ask</NuxtLink>
        <NuxtLink to="/">Search</NuxtLink>
        <NuxtLink to="/library">Library</NuxtLink>
        <NuxtLink to="/feed">Add document</NuxtLink>
        <NuxtLink to="/connect">Connect Claude</NuxtLink>
      </nav>
      <span v-if="accessEmail" class="archive-account" aria-label="Signed in email">{{ accessEmail }}</span>
    </header>
    <NuxtPage />
    <footer class="archive-disclaimer">Korwell can make mistakes. The archive is only human.</footer>
  </div>
</template>
