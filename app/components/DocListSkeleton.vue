<script setup lang="ts">
// Placeholder rows shaped like the Library list. Announce loading in the parent.
withDefaults(defineProps<{ rows?: number }>(), { rows: 6 })
const titleWidths = [72, 58, 80, 64, 76, 54]
</script>

<template>
  <ul class="border-t border-default" aria-hidden="true">
    <li v-for="row in rows" :key="row" class="grid gap-2 border-b border-default px-[clamp(1rem,4vw,1.75rem)] py-4">
      <USkeleton class="h-4 rounded-full bg-accented" :style="{ width: `${titleWidths[(row - 1) % titleWidths.length]}%` }" />
      <USkeleton class="h-3 w-[38%] rounded-full bg-accented" />
    </li>
  </ul>
</template>
