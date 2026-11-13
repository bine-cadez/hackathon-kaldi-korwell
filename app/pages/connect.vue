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
  <main class="mx-auto w-[min(46rem,calc(100%-2rem))] pt-10 pb-16">
    <ArchiveEye class="mx-0 w-32" />
    <PageHeading eyebrow="Connectors" title="Connect Claude">
      Let Claude search the library and the Slack archive. Read-only: Claude can search and read
      documents, never add or delete them.
    </PageHeading>

    <div class="grid gap-4">
      <UCard as="section">
        <h2 class="text-xl">Server URL</h2>
        <CopyField :value="mcpUrl" :copied="copied === mcpUrl" @copy="copy(mcpUrl)" />
        <p v-if="healthError" class="mt-3 text-error">Could not check the connector status.</p>
        <UAlert v-else-if="health && !health.mcp" class="mt-3" color="error" variant="subtle" icon="i-lucide-plug-zap">
          <template #description>
            The connector is turned off on this server (<code>MCP_SIGNING_KEY</code> is not set).
            Ask an admin before connecting.
          </template>
        </UAlert>
        <p v-else-if="health" class="mt-3 flex items-center gap-1.5 text-success">
          <UIcon name="i-lucide-circle-check" class="size-4" /> The connector is on.
        </p>
      </UCard>

      <UCard as="section">
        <h2 class="text-xl">Claude Team or Enterprise</h2>
        <p class="mt-2 text-sm text-muted">An organization Owner adds the connector once:</p>
        <ol class="mt-1.5 mb-4 grid list-decimal gap-1.5 pl-5">
          <li>Open <strong>Admin settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</li>
          <li>Name it <strong>Korwell</strong> and paste the server URL above.</li>
          <li>Leave the OAuth client ID and secret empty. Claude registers itself.</li>
        </ol>
        <p class="text-sm text-muted">Then everyone connects with their own work email:</p>
        <ol class="mt-1.5 mb-4 grid list-decimal gap-1.5 pl-5">
          <li>Open <strong>Settings → Connectors</strong>, find <strong>Korwell</strong>, and choose <strong>Connect</strong>.</li>
          <li>Sign in with your Kaldi email if asked, then choose <strong>Allow read access</strong>.</li>
          <li>In a chat, ask Claude to search the Kaldi Archive.</li>
        </ol>
        <p class="text-muted">
          Each connection belongs to the person who approved it and lasts up to 30 days. After that,
          Claude asks you to approve it again.
        </p>
      </UCard>

      <UCard as="section">
        <h2 class="text-xl">Claude Code</h2>
        <CopyField :value="claudeCodeCommand" :copied="copied === claudeCodeCommand" @copy="copy(claudeCodeCommand)" />
        <p class="mt-3 text-muted">Run <code>/mcp</code> in Claude Code to sign in. The approval page opens in your browser.</p>
      </UCard>
    </div>
  </main>
</template>
