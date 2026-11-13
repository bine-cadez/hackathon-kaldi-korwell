<script setup lang="ts">
// Placeholder rows shaped like the Library list. Announce loading in the parent.
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
const titleWidths = [62, 48, 70, 54, 66, 44]
</script>

<template>
  <ul class="doc-list" aria-hidden="true">
    <li v-for="row in rows" :key="row" class="doc-skeleton">
      <div>
        <span class="skeleton skeleton-title" :style="{ width: `${titleWidths[(row - 1) % titleWidths.length]}%` }" />
        <span class="skeleton skeleton-meta" />
      </div>
      <span class="skeleton skeleton-button" />
    </li>
  </ul>
</template>
