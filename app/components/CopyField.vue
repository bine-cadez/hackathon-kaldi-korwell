<script setup lang="ts">
// A value to paste somewhere else, with a Copy button.
defineProps<{ value: string, copied: boolean }>()
const emit = defineEmits<{ copy: [] }>()
</script>

<template>
  <div class="flex max-w-2xl items-center gap-3 rounded-full border border-accented bg-default py-1.5 pr-1.5 pl-5">
    <code class="min-w-0 flex-1 truncate text-sm text-highlighted" :title="value">{{ value }}</code>
    <UButton
      class="flex-none"
      color="neutral"
      variant="outline"
      size="sm"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :label="copied ? 'Copied' : 'Copy'"
      @click="emit('copy')"
    />
  </div>
</template>
