<script setup lang="ts">
// Brown Kaldi bar shared by the app and the error page. `external` makes the
// brand a plain link (a full page load), which the error page needs.
defineProps<{ external?: boolean }>()
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b-3 border-orange bg-primary px-[clamp(1rem,5vw,4rem)] py-3 text-paper">
    <NuxtLink class="font-serif text-3xl font-semibold" to="/" :external="external">The Kaldi Archive</NuxtLink>
    <slot />
  </header>
</template>
