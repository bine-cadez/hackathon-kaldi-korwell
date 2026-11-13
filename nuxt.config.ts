// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  experimental: { viewTransition: true },
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  vite: {
    server: {
      headers: {
        'X-Robots-Tag': 'noindex, nofollow'
      }
    }
  },
  routeRules: {
    '/**': {
      headers: {
        'X-Robots-Tag': 'noindex, nofollow'
      }
    }
  },
  runtimeConfig: {
    // Populated at runtime from NUXT_OPENROUTER_API_KEY if set.
    // Prefer OPENROUTER_API_KEY via .env locally or `wrangler secret put` in production.
    openrouterApiKey: ''
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    }
  }
})
