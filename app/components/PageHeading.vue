<script setup lang="ts">
// Eyebrow and title at the top of a page. The default slot holds the lede.
defineProps<{ eyebrow: string, title: string }>()
</script>

<template>
  <div class="mb-6">
    <p class="eyebrow">{{ eyebrow }}</p>
    <h1 class="mt-1 text-4xl leading-tight">{{ title }}</h1>
    <p v-if="$slots.default" class="mt-2 max-w-2xl text-muted">
      <slot />
    </p>
  </div>
</template>
