<script setup lang="ts">
// Placeholder search results (title, meta line, passage, action), used by
// document and Slack search. Announce loading in the parent.
withDefaults(defineProps<{ count?: number }>(), { count: 3 })
const titleWidths = [46, 58, 38]
</script>

<template>
  <ol class="results" aria-hidden="true">
    <li v-for="item in count" :key="item" class="result result-skeleton">
      <span class="skeleton skeleton-title" :style="{ width: `${titleWidths[(item - 1) % titleWidths.length]}%` }" />
      <span class="skeleton skeleton-meta" />
      <span class="skeleton-passage">
        <span class="skeleton" style="width: 98%" />
        <span class="skeleton" style="width: 91%" />
        <span class="skeleton" style="width: 64%" />
      </span>
      <span class="skeleton skeleton-button" />
    </li>
  </ol>
</template>
