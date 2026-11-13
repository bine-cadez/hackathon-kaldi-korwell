<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// Real links, so pages can be opened in a new tab and the back button works.
// RouterLink marks every link to /library as aria-current="page" because it
// ignores the query string; `aria-current="false"` overrides that on each link.
const props = defineProps<{
  page: number
  totalPages: number
  linkFor: (page: number) => RouteLocationRaw
}>()

const items = computed(() => paginationItems(props.page, props.totalPages))
</script>

<template>
  <nav v-if="totalPages > 1" class="pagination" aria-label="Library pages">
    <NuxtLink
      v-if="page > 1"
      class="pagination-step"
      :to="linkFor(page - 1)"
      rel="prev"
      aria-current="false"
    >
      <span aria-hidden="true">←</span> Previous
    </NuxtLink>
    <span v-else class="pagination-step" aria-disabled="true"><span aria-hidden="true">←</span> Previous</span>

    <ol class="pagination-pages">
      <li v-for="(item, index) in items" :key="item ?? `gap-${index}`">
        <span v-if="item === null" class="pagination-gap" aria-hidden="true">…</span>
        <span v-else-if="item === page" class="pagination-page" aria-current="page">
          <span class="sr-only">Page </span>{{ item }}
        </span>
        <NuxtLink v-else class="pagination-page" :to="linkFor(item)" aria-current="false">
          <span class="sr-only">Page </span>{{ item }}
        </NuxtLink>
      </li>
    </ol>

    <NuxtLink
      v-if="page < totalPages"
      class="pagination-step"
      :to="linkFor(page + 1)"
      rel="next"
      aria-current="false"
    >
      Next <span aria-hidden="true">→</span>
    </NuxtLink>
    <span v-else class="pagination-step" aria-disabled="true">Next <span aria-hidden="true">→</span></span>
  </nav>
</template>
