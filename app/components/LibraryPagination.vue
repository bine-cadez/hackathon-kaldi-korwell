<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// Real links, so pages can be opened in a new tab and the back button works.
// RouterLink marks every link to /library as aria-current="page" because it
// ignores the query string; `aria-current="false"` overrides that on each link.
const props = defineProps<{
  page: number
  totalPages: number
  linkFor: (page: number) => RouteLocationRaw
  /** Previous and Next around "Page 2 of 9", for narrow columns. */
  compact?: boolean
}>()

const items = computed(() => paginationItems(props.page, props.totalPages))

// Pill links in the Kaldi style, matching Nuxt UI's outline buttons.
const pill = 'inline-flex min-h-10 items-center justify-center rounded-full border tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const linkClass = 'border-accented text-default hover:border-primary hover:text-primary'
const pageClass = `${pill} min-w-10 px-3`
const stepClass = `${pill} gap-1.5 px-3.5`
const disabledClass = 'border-default text-muted opacity-50'
</script>

<template>
  <nav v-if="totalPages > 1" class="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label="Library pages">
    <NuxtLink
      v-if="page > 1"
      :class="[stepClass, linkClass]"
      :to="linkFor(page - 1)"
      rel="prev"
      aria-current="false"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4" /> Previous
    </NuxtLink>
    <span v-else :class="[stepClass, disabledClass]" aria-disabled="true"><UIcon name="i-lucide-arrow-left" class="size-4" /> Previous</span>

    <p v-if="compact" class="m-0 text-sm text-muted tabular-nums" aria-current="page">Page {{ page }} of {{ totalPages }}</p>
    <ol v-else class="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
      <li v-for="(item, index) in items" :key="item ?? `gap-${index}`">
        <span v-if="item === null" class="inline-grid min-h-10 min-w-6 place-items-center text-muted" aria-hidden="true">…</span>
        <span v-else-if="item === page" :class="[pageClass, 'border-primary bg-primary font-bold text-inverted']" aria-current="page">
          <span class="sr-only">Page </span>{{ item }}
        </span>
        <NuxtLink v-else :class="[pageClass, linkClass]" :to="linkFor(item)" aria-current="false">
          <span class="sr-only">Page </span>{{ item }}
        </NuxtLink>
      </li>
    </ol>

    <NuxtLink
      v-if="page < totalPages"
      :class="[stepClass, linkClass]"
      :to="linkFor(page + 1)"
      rel="next"
      aria-current="false"
    >
      Next <UIcon name="i-lucide-arrow-right" class="size-4" />
    </NuxtLink>
    <span v-else :class="[stepClass, disabledClass]" aria-disabled="true">Next <UIcon name="i-lucide-arrow-right" class="size-4" /></span>
  </nav>
</template>
