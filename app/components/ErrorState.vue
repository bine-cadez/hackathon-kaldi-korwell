<script setup lang="ts">
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

function reload () {
  window.location.reload()
}
</script>

<template>
  <div class="error-state" :class="{ 'error-state--compact': compact }" role="alert">
    <svg class="error-state-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <circle cx="12" cy="16.5" r="1.2" fill="currentColor" />
    </svg>
    <div class="error-state-text">
      <p class="error-state-title">{{ heading }}</p>
      <p v-if="described.message && described.message !== heading" class="error-state-message">{{ described.message }}</p>
    </div>
    <div v-if="described.needsSignIn || (onRetry && described.canRetry) || onDismiss" class="error-state-actions">
      <button v-if="described.needsSignIn" class="ghost" type="button" @click="reload">Reload page</button>
      <button
        v-else-if="onRetry && described.canRetry"
        class="ghost"
        type="button"
        :disabled="retrying"
        @click="onRetry()"
      >
        {{ retrying ? 'Trying again…' : retryLabel }}
      </button>
      <button v-if="onDismiss" class="error-state-dismiss" type="button" @click="onDismiss()">Dismiss</button>
    </div>
  </div>
</template>
