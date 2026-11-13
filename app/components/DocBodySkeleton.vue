<script setup lang="ts">
// Placeholder paragraph for a document body that is still loading.
withDefaults(defineProps<{ lines?: number }>(), { lines: 6 })
const lineWidths = [96, 88, 92, 70, 94, 52, 84, 60]
</script>

<template>
  <div class="mt-4 grid gap-2.5" aria-hidden="true">
    <USkeleton v-for="line in lines" :key="line" class="h-3 rounded-full bg-accented" :style="{ width: `${lineWidths[(line - 1) % lineWidths.length]}%` }" />
  </div>
</template>
