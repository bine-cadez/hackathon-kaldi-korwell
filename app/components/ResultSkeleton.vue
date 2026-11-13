<script setup lang="ts">
// Placeholder search results (title, meta line, passage, action), used by
// document and Slack search. Announce loading in the parent.
withDefaults(defineProps<{ count?: number }>(), { count: 3 })
const titleWidths = [46, 58, 38]
</script>

<template>
  <ol class="mt-3 grid gap-2" aria-hidden="true">
    <li v-for="item in count" :key="item" class="grid justify-items-start gap-2 rounded-xl border border-default bg-default p-3">
      <USkeleton class="h-4 rounded-full bg-accented" :style="{ width: `${titleWidths[(item - 1) % titleWidths.length]}%` }" />
      <USkeleton class="h-3 w-[28%] rounded-full bg-accented" />
      <div class="my-1 grid w-full gap-2 rounded-lg bg-paper p-3">
        <USkeleton class="h-3 w-[98%] rounded-full bg-accented" />
        <USkeleton class="h-3 w-[91%] rounded-full bg-accented" />
        <USkeleton class="h-3 w-[64%] rounded-full bg-accented" />
      </div>
      <USkeleton class="h-8 w-18 rounded-full bg-accented" />
    </li>
  </ol>
</template>
