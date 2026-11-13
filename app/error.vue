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
  <div>
    <header class="archive-header">
      <a class="archive-brand" href="/">The Kaldi Archive</a>
    </header>
    <main class="archive-page error-page">
      <ArchiveEye :no-results="true" />
      <p class="error-code">Error {{ error.statusCode }}</p>
      <h1>{{ heading }}</h1>
      <p class="lede">{{ lede }}</p>
      <div class="row" style="justify-content: center">
        <button class="primary" type="button" @click="goHome">Back to search</button>
        <button v-if="!notFound" class="ghost" type="button" @click="tryAgain">Try again</button>
      </div>
    </main>
  </div>
</template>
