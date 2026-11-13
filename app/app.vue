<script setup lang="ts">
const accessEmail = useState<string | null>('korwell-access-email', () => {
  if (import.meta.server) return useRequestEvent()?.context.korwellAccessUser?.email ?? null
  return null
})

const links = [
  { label: 'Ask', to: '/chat' },
  { label: 'Search', to: '/' },
  { label: 'Library', to: '/library' },
  { label: 'Add document', to: '/feed' },
  { label: 'Connect Claude', to: '/connect' }
]
// Document pages (/library/<id>) belong to the Library section of the nav.
const route = useRoute()
const inLibrary = computed(() => route.path.startsWith('/library/'))

useHead({
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/korwell-eye.svg?v=2' }]
})
</script>

<template>
  <UApp>
    <!-- The page's <main> fills the height, keeping the footer at the bottom. -->
    <div class="flex min-h-screen flex-col [&>main]:flex-[1_0_auto]">
      <NuxtRouteAnnouncer />
      <AppHeader>
        <nav aria-label="Main navigation" class="flex flex-wrap gap-x-6 gap-y-2">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="underline-offset-[0.35em] hover:underline"
            exact-active-class="underline"
            :class="{ underline: link.to === '/library' && inLibrary }"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
        <span v-if="accessEmail" class="text-sm [overflow-wrap:anywhere]" aria-label="Signed in email">{{ accessEmail }}</span>
      </AppHeader>
      <NuxtPage />
      <footer class="px-16 py-4 text-center text-xs text-muted">Korwell can make mistakes. The archive is only human.</footer>
    </div>
  </UApp>
</template>
