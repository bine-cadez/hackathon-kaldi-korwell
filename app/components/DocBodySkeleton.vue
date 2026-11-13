<script setup lang="ts">
// Placeholder paragraph for a document body that is still loading.
withDefaults(defineProps<{ lines?: number }>(), { lines: 6 })
const lineWidths = [96, 88, 92, 70, 94, 52, 84, 60]
</script>

<template>
  <div class="doc-body-skeleton" aria-hidden="true">
    <span v-for="line in lines" :key="line" class="skeleton" :style="{ width: `${lineWidths[(line - 1) % lineWidths.length]}%` }" />
  </div>
</template>
