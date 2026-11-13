<script setup lang="ts">
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
  <main class="archive-page">
    <ArchiveEye />
    <p class="eyebrow">Connectors</p>
    <h1>Connect Claude</h1>
    <p class="lede">
      Let Claude search the library and the Slack archive. Read-only: Claude can search and read
      documents, never add or delete them.
    </p>

    <section class="card">
      <h2>Server URL</h2>
      <div class="copy-field">
        <code>{{ mcpUrl }}</code>
        <button class="ghost" type="button" @click="copy(mcpUrl)">
          {{ copied === mcpUrl ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p v-if="healthError" class="err">Could not check the connector status.</p>
      <p v-else-if="health && !health.mcp" class="err">
        The connector is turned off on this server (<code>MCP_SIGNING_KEY</code> is not set).
        Ask an admin before connecting.
      </p>
      <p v-else-if="health" class="ok">The connector is on.</p>
    </section>

    <section class="card">
      <h2>Claude Team or Enterprise</h2>
      <p class="meta">An organization Owner adds the connector once:</p>
      <ol class="steps">
        <li>Open <strong>Admin settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</li>
        <li>Name it <strong>Korwell</strong> and paste the server URL above.</li>
        <li>Leave the OAuth client ID and secret empty. Claude registers itself.</li>
      </ol>
      <p class="meta">Then everyone connects with their own work email:</p>
      <ol class="steps">
        <li>Open <strong>Settings → Connectors</strong>, find <strong>Korwell</strong>, and choose <strong>Connect</strong>.</li>
        <li>Sign in with your Kaldi email if asked, then choose <strong>Allow read access</strong>.</li>
        <li>In a chat, ask Claude to search the Kaldi Archive.</li>
      </ol>
      <p class="note">
        Each connection belongs to the person who approved it and lasts up to 30 days. After that,
        Claude asks you to approve it again.
      </p>
    </section>

    <section class="card">
      <h2>Claude Code</h2>
      <div class="copy-field">
        <code>{{ claudeCodeCommand }}</code>
        <button class="ghost" type="button" @click="copy(claudeCodeCommand)">
          {{ copied === claudeCodeCommand ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="note">Run <code>/mcp</code> in Claude Code to sign in. The approval page opens in your browser.</p>
    </section>
  </main>
</template>
