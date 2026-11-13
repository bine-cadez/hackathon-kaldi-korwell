<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

// One error block for the whole app. Pass the raw error; it picks the wording
// and the right action (retry, reload when signed out, or nothing).
// Listening to @retry or @dismiss shows the matching button.
const props = withDefaults(defineProps<{
  error: unknown
  /** Overrides the generic title with what failed, e.g. "Couldn’t load the library". */
  title?: string
  /** Smaller inline banner for errors next to content that is still usable. */
  compact?: boolean
  retrying?: boolean
  retryLabel?: string
  onRetry?: () => unknown
  onDismiss?: () => unknown
}>(), {
  title: undefined,
  compact: false,
  retrying: false,
  retryLabel: 'Try again',
  onRetry: undefined,
  onDismiss: undefined
})

const described = computed(() => describeError(props.error))
// Say what failed ("Couldn’t load the library") unless the error itself is more
// telling: offline, signed out, not found, bad input.
const heading = computed(() => {
  const { status, title } = described.value
  const generic = title === 'Something went wrong' || (status !== undefined && status >= 500)
  return props.title && generic ? props.title : title
})

const description = computed(() => {
  const { message } = described.value
  return message && message !== heading.value ? message : undefined
})

const actions = computed(() => {
  const list: ButtonProps[] = []
  const size = props.compact ? 'xs' : 'sm'
  if (described.value.needsSignIn) {
    list.push({ label: 'Reload page', color: 'neutral', variant: 'outline', size, onClick: () => window.location.reload() })
  } else if (props.onRetry && described.value.canRetry) {
    list.push({
      label: props.retrying ? 'Trying again…' : props.retryLabel,
      color: 'neutral',
      variant: 'outline',
      size,
      loading: props.retrying,
      onClick: () => props.onRetry?.()
    })
  }
  if (props.onDismiss) {
    list.push({ label: 'Dismiss', color: 'neutral', variant: 'link', size, onClick: () => props.onDismiss?.() })
  }
  return list
})
</script>

<template>
  <UAlert
    role="alert"
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="heading"
    :description="description"
    :actions="actions"
    :class="compact ? 'mt-3 p-3' : 'mt-3'"
    :ui="{ title: 'font-bold', description: '[overflow-wrap:anywhere] text-muted opacity-100' }"
  />
</template>
