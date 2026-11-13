<script setup lang="ts">
// Panel of search filter fields (UFormField children), two per row on wide screens.
defineProps<{ active?: boolean }>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div class="grid gap-x-4 gap-y-3 rounded-xl border border-default bg-default p-4 text-start sm:grid-cols-2 [&_label]:font-bold [&_label]:text-primary">
    <slot />
    <UButton
      v-if="active"
      class="col-span-full justify-self-start px-0 underline underline-offset-[0.2em]"
      variant="link"
      size="sm"
      label="Clear filters"
      @click="emit('clear')"
    />
  </div>
</template>
