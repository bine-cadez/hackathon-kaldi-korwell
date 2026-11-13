<script setup lang="ts">
import type { NuxtError } from '#app'

// Replaces the whole app on a fatal error (unknown page, crashed render), so it
// brings its own header.
const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const heading = computed(() => notFound.value ? 'This page isn’t in the archive' : 'Something went wrong')
const lede = computed(() => notFound.value
  ? 'The address may be mistyped, or the page has moved.'
  : 'The page couldn’t be shown. Try again, or go back to search.')

useHead({ title: computed(() => notFound.value ? 'Not found · Korwell' : 'Error · Korwell') })

function goHome () {
  clearError({ redirect: '/' })
}

function tryAgain () {
  window.location.reload()
}
</script>

<template>
  <UApp>
    <!-- A plain link: a full load leaves the error state behind. -->
    <AppHeader external />
    <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-16 text-center">
      <ArchiveEye :no-results="true" />
      <p class="mt-2 text-xs font-bold tracking-[0.2em] text-muted uppercase">Error {{ error.statusCode }}</p>
      <h1 class="text-4xl">{{ heading }}</h1>
      <p class="mx-auto mt-3 mb-6 max-w-lg text-muted">{{ lede }}</p>
      <div class="flex flex-wrap justify-center gap-2">
        <UButton label="Back to search" @click="goHome" />
        <UButton v-if="!notFound" color="neutral" variant="outline" label="Try again" @click="tryAgain" />
      </div>
    </main>
  </UApp>
</template>
