<script setup lang="ts">
// Placeholder rows shaped like the Library list. Announce loading in the parent.
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
const titleWidths = [62, 48, 70, 54, 66, 44]
</script>

<template>
  <ul class="mt-3 grid gap-2" aria-hidden="true">
    <li v-for="row in rows" :key="row" class="flex items-center gap-3 rounded-xl border border-default p-3">
      <div class="grid flex-1 gap-2">
        <USkeleton class="h-4 rounded-full bg-accented" :style="{ width: `${titleWidths[(row - 1) % titleWidths.length]}%` }" />
        <USkeleton class="h-3 w-[28%] rounded-full bg-accented" />
      </div>
      <USkeleton class="h-8 w-18 rounded-full bg-accented" />
    </li>
  </ul>
</template>
