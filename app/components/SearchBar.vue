<script setup lang="ts">
// The big search field used by document and Slack search. Extra attributes and
// listeners (inputmode, @focus, @keyup, …) go to the <input> itself.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  inputId: string
  label: string
  placeholder: string
  searching?: boolean
  invalid?: boolean
  describedBy?: string
  clearable?: boolean
}>()
const emit = defineEmits<{ clear: [] }>()
const model = defineModel<string>({ required: true })

const field = ref<{ inputRef: HTMLInputElement | null } | null>(null)
defineExpose({ inputRef: computed(() => field.value?.inputRef ?? null) })
</script>

<template>
  <div class="flex gap-1.5 rounded-xl border border-primary bg-default p-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
    <label class="sr-only" :for="inputId">{{ label }}</label>
    <UInput
      :id="inputId"
      ref="field"
      v-model="model"
      v-bind="$attrs"
      type="text"
      name="query"
      variant="none"
      size="xl"
      class="min-w-0 flex-1"
      :ui="{ base: 'focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none' }"
      :placeholder="placeholder"
      :aria-invalid="invalid || undefined"
      :aria-describedby="describedBy"
    />
    <UButton
      v-if="clearable && model"
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="lg"
      square
      class="self-center text-primary"
      aria-label="Clear search"
      title="Clear search"
      @click="emit('clear')"
    />
    <UButton
      type="submit"
      icon="i-lucide-search"
      color="neutral"
      variant="ghost"
      size="xl"
      square
      class="rounded-lg text-orange"
      :disabled="props.searching"
      :aria-label="props.searching ? 'Searching…' : 'Search'"
      title="Search"
    />
  </div>
</template>
