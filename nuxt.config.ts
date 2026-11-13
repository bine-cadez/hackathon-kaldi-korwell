// https://nuxt.com/docs/api/configuration/nuxt-config
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const AI_BINDING = { binding: 'AI' }

// `AI_REMOTE=true npm run dev` loads the Workers AI binding in dev so PDF,
// Word, and Excel uploads convert locally. It writes wrangler.jsonc plus the
// AI binding to .wrangler/dev-ai/wrangler.json and points the dev proxy at it.
// Needs `npx wrangler login`: the AI binding has no local simulator.
function devConfigWithAI (): string | undefined {
  if (process.env.AI_REMOTE !== 'true') return undefined
  const { experimental_readRawConfig: readRawConfig } = createRequire(import.meta.url)('wrangler')
  const { rawConfig } = readRawConfig({ config: resolve('wrangler.jsonc') })
  const { $schema: _schema, ...config } = rawConfig
  const dir = resolve('.wrangler/dev-ai')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, 'wrangler.json')
  writeFileSync(path, JSON.stringify({ ...config, ai: AI_BINDING }, null, 2))
  return path
}

const devConfigPath = devConfigWithAI()

export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  // Pinia Colada caches API data (see app/queries/documents.ts) and hands the
  // SSR cache to the client, so the first render does not fetch twice.
  // Nuxt UI brings Tailwind CSS and the U* components; the theme lives in
  // app/assets/main.css (colours, fonts) and app/app.config.ts (component defaults).
  modules: ['@nuxt/ui', '@pinia/nuxt', '@pinia/colada-nuxt'],
  ui: {
    // The archive is light-only, and its fonts are self-hosted in public/kaldi-fonts.
    colorMode: false,
    fonts: false
  },
  icon: {
    // Ship the Lucide icons the app uses with the page instead of fetching them.
    clientBundle: { scan: true }
  },
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
      nodeCompat: true,
      // Workers AI toMarkdown converts PDF, Word, and Excel uploads. Declared
      // here instead of wrangler.jsonc so it lands only in the generated
      // .output/server/wrangler.json (deploy, preview). The AI binding is
      // always remote; in wrangler.jsonc it would make `npm run dev` open a
      // remote session, and without `wrangler login` that drops D1 as well.
      // Dev opts in with AI_REMOTE=true (see devConfigWithAI above).
      wrangler: {
        ai: AI_BINDING
      },
      ...(devConfigPath ? { dev: { configPath: devConfigPath } } : {})
    }
  }
})
