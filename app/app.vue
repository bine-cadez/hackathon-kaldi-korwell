<script setup lang="ts">
useHead({
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/korwell-eye.svg?v=2' }]
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <header class="archive-header">
      <NuxtLink class="archive-brand" to="/">The Kaldi Archive</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/">Search</NuxtLink>
        <NuxtLink to="/library">Library</NuxtLink>
        <NuxtLink to="/feed">Add document</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
