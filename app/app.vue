<script setup lang="ts">
const links = [
  { label: 'Ask', to: '/' },
  { label: 'Library', to: '/library' },
  { label: 'Connect Claude', to: '/connect' }
]
// Document pages (/library/<id>) belong to the Library section of the nav.
const route = useRoute()
const current = (to: string) => to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)

useHead({
  titleTemplate: title => title ? `${title} · Korwell` : 'Korwell',
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/korwell-eye.svg?v=2' }]
})
</script>

<template>
  <UApp>
    <!-- The page's <main> fills the height, keeping the footer at the bottom. -->
    <div class="flex min-h-screen flex-col [&>main]:flex-[1_0_auto]">
      <NuxtRouteAnnouncer />
      <AppHeader>
        <nav aria-label="Main navigation" class="flex flex-wrap items-center gap-x-8 gap-y-2 tracking-wide uppercase lg:ml-auto">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            :class="{ 'text-primary': current(link.to) }"
            :aria-current="current(link.to) ? 'page' : undefined"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
        <UButton to="/feed" icon="i-lucide-plus" label="Add document" class="uppercase" :variant="current('/feed') ? 'outline' : 'solid'" />
        <UserMenu />
      </AppHeader>
      <NuxtPage />
      <footer class="border-t border-default px-[clamp(1rem,5vw,4.5rem)] py-4 text-sm text-muted">Korwell can make mistakes. The archive is only human.</footer>
    </div>
  </UApp>
</template>
