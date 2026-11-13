<script setup lang="ts">
useHead({ title: 'Connect Claude' })

interface Health {
  mcp: boolean
  auth: 'open' | 'password' | 'cloudflare-access'
}

const mcpUrl = `${useRequestURL().origin}/mcp`
const claudeCodeCommand = `claude mcp add --transport http korwell ${mcpUrl}`

const { data: health, error: healthError } = await useFetch<Health>('/api/health')

const copied = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy (value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = value
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = '' }, 2000)
  } catch {
    copied.value = ''
  }
}
</script>

<template>
  <main>
    <section class="studio-section" aria-labelledby="connect-title">
      <div>
        <p class="eyebrow">Connect Claude</p>
        <h1 id="connect-title" class="mt-4 text-[2rem] leading-tight font-light">Search Korwell from inside Claude.</h1>
      </div>
      <div class="min-w-0">
        <p class="mb-6 max-w-2xl text-lg leading-relaxed">
          Claude can search and read the library and the Slack archive. It can’t add or delete anything.
        </p>
        <CopyField :value="mcpUrl" :copied="copied === mcpUrl" @copy="copy(mcpUrl)" />
        <p v-if="healthError" class="mt-3 text-error">Could not check the connector status.</p>
        <UAlert v-else-if="health && !health.mcp" class="mt-3 max-w-2xl" color="error" variant="subtle" icon="i-lucide-plug-zap">
          <template #description>
            The connector is turned off on this server (<code>MCP_SIGNING_KEY</code> is not set).
            Ask an admin before connecting.
          </template>
        </UAlert>
        <p v-else-if="health" class="mt-3 flex items-center gap-2 text-success">
          <span class="size-2 rounded-full bg-success ring-4 ring-success/15" aria-hidden="true" /> The connector is on.
        </p>
      </div>
    </section>

    <section class="studio-section border-t border-default" aria-labelledby="connect-team">
      <h2 id="connect-team" class="text-[2rem] leading-tight font-light">Claude Team or Enterprise</h2>
      <div class="min-w-0">
        <h3 class="text-xl">An organisation Owner adds it once</h3>
        <ol class="steps">
          <li><span>Open <strong>Admin settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</span></li>
          <li><span>Name it <strong>Korwell</strong> and paste the server URL above.</span></li>
          <li><span>Leave the OAuth client ID and secret empty. Claude registers itself.</span></li>
        </ol>
        <h3 class="mt-8 text-xl">Then everyone connects with their work email</h3>
        <ol class="steps">
          <li><span>Open <strong>Settings → Connectors</strong>, find <strong>Korwell</strong>, and choose <strong>Connect</strong>.</span></li>
          <li><span>Sign in with your Kaldi email if asked, then choose <strong>Allow read access</strong>.</span></li>
          <li><span>In a chat, ask Claude to search Korwell.</span></li>
        </ol>
        <p class="mt-6 max-w-2xl text-muted">
          Each connection belongs to the person who approved it and lasts up to 30 days. After that,
          Claude asks you to approve it again.
        </p>
      </div>
    </section>

    <section class="studio-section border-t border-default" aria-labelledby="connect-code">
      <h2 id="connect-code" class="text-[2rem] leading-tight font-light">Claude Code</h2>
      <div class="min-w-0">
        <CopyField :value="claudeCodeCommand" :copied="copied === claudeCodeCommand" @copy="copy(claudeCodeCommand)" />
        <p class="mt-4 text-muted">Run <code>/mcp</code> in Claude Code to sign in. The approval page opens in your browser.</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* Numbered steps in orange rings: they must be done in order. */
.steps {
  counter-reset: step;
  display: grid;
  gap: 0.8rem;
  max-width: 42rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 1.075rem;
  line-height: 1.55;
}
.steps li {
  counter-increment: step;
  display: grid;
  grid-template-columns: 1.8rem 1fr;
  gap: 0.8rem;
}
.steps li::before {
  content: counter(step);
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  border: 1px solid var(--ui-primary);
  border-radius: 999px;
  color: var(--color-link);
  font-size: 0.9rem;
  font-weight: 400;
}
</style>
