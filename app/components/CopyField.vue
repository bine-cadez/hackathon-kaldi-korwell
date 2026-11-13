<script setup lang="ts">
// A value to paste somewhere else, with a Copy button.
defineProps<{ value: string, copied: boolean }>()
const emit = defineEmits<{ copy: [] }>()
</script>

<template>
  <div class="mt-2.5 flex items-center gap-2 rounded-lg border border-default bg-paper py-1.5 pr-1.5 pl-3">
    <code class="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{{ value }}</code>
    <UButton
      class="flex-none"
      color="neutral"
      variant="outline"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :label="copied ? 'Copied' : 'Copy'"
      @click="emit('copy')"
    />
  </div>
</template>
