import type { PiniaColadaOptions } from '@pinia/colada'

// Global Pinia Colada options, picked up by @pinia/colada-nuxt.
export default {
  queryOptions: {
    // A failed query during SSR becomes the query's error state (rendered as an
    // ErrorState with a retry) instead of failing the whole page with a 500.
    ssrCatchError: true
  }
} satisfies PiniaColadaOptions
