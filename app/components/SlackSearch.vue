<script setup lang="ts">
interface SlackParent {
  ts: string
  text: string
  userDisplayName: string
  userRealName: string
  deleted: boolean
}

interface SlackHit {
  channelId: string
  channelName: string
  ts: string
  sentAt: string | null
  userId: string | null
  userDisplayName: string
  userRealName: string
  text: string
  threadTs: string | null
  replyCount: number | null
  editedAt: string | null
  deleted: boolean
  deletedAt: string | null
  isBot: boolean
  permalink: string | null
  parent: SlackParent | null
  files: Array<{ name: string | null, title: string | null }>
}

const query = ref('')
const channel = ref('')
const user = ref('')
const fromDate = ref('')
const toDate = ref('')
const searching = ref(false)
const searched = ref(false)
const queryInvalid = ref(false)
// Raw error so ErrorState can tell a network failure from a server one.
const searchError = ref<unknown>(null)
const matches = ref<SlackHit[]>([])

function author (hit: { userDisplayName: string, userRealName: string, isBot: boolean, userId: string | null }) {
  const name = hit.userDisplayName || hit.userRealName
  if (name && hit.isBot) return `${name} (bot)`
  if (name) return name
  if (hit.isBot) return 'Bot'
  return hit.userId || 'Unknown'
}

function when (hit: SlackHit) {
  if (!hit.sentAt) return hit.ts
  const date = new Date(hit.sentAt)
  if (Number.isNaN(date.getTime())) return hit.sentAt
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

async function runSearch () {
  if (searching.value) return
  if (!query.value.trim() && !channel.value.trim() && !user.value.trim() && !fromDate.value && !toDate.value) {
    queryInvalid.value = true
    return
  }
  queryInvalid.value = false
  searching.value = true
  searched.value = true
  searchError.value = null
  try {
    const result = await $fetch<{ matches: SlackHit[] }>('/api/slack/search', {
      method: 'POST',
      body: {
        query: query.value,
        channel: channel.value || undefined,
        user: user.value || undefined,
        from: fromDate.value || undefined,
        to: toDate.value || undefined,
        limit: 20
      }
    })
    matches.value = result.matches
  } catch (error) {
    matches.value = []
    searchError.value = error
  } finally {
    searching.value = false
  }
}
</script>

<template>
  <div class="text-start">
    <form class="grid gap-3.5" role="search" novalidate @submit.prevent="runSearch">
      <SearchBar
        v-model="query"
        input-id="slack-query"
        label="Search Slack messages"
        placeholder="Search Slack messages…"
        :searching="searching"
        :invalid="queryInvalid"
        @input="queryInvalid = false"
      />
      <SearchFilters>
        <UFormField label="Channel">
          <UInput v-model="channel" name="channel" maxlength="200" placeholder="Name or channel ID" class="w-full" />
        </UFormField>
        <UFormField label="Person">
          <UInput v-model="user" name="user" maxlength="200" placeholder="Name or user ID" class="w-full" />
        </UFormField>
        <UFormField label="From">
          <UInput v-model="fromDate" type="date" name="from" class="w-full" />
        </UFormField>
        <UFormField label="To">
          <UInput v-model="toDate" type="date" name="to" class="w-full" />
        </UFormField>
      </SearchFilters>
      <p class="m-0 text-sm text-muted">Dates include the whole day, in UTC. Deleted messages stay in the archive and are marked deleted.</p>
    </form>
    <UAlert
      v-if="queryInvalid"
      role="alert"
      color="warning"
      variant="subtle"
      class="mt-3"
      title="Enter a search term or a channel, person, or date."
    />
    <section v-if="searched" class="mt-8 border-t-3 border-double border-default pt-4" aria-label="Slack results" :aria-busy="searching">
      <template v-if="searching">
        <p role="status" class="sr-only">Searching Slack…</p>
        <ResultSkeleton />
      </template>
      <ErrorState v-else-if="searchError" :error="searchError" title="Slack search didn’t finish" @retry="runSearch()" />
      <p v-else-if="!matches.length" role="status">No Slack messages matched.</p>
      <template v-else>
        <h2 class="text-2xl">From Slack</h2>
        <ol class="mt-3 grid gap-2">
          <li v-for="hit in matches" :key="hit.channelId + hit.ts" class="rounded-xl border border-default bg-default p-3">
            <h3 class="text-lg">{{ author(hit) }}</h3>
            <p class="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <span>{{ hit.channelName ? '#' + hit.channelName : hit.channelId }}</span>
              <span>· {{ when(hit) }}</span>
              <UBadge v-if="hit.editedAt" color="neutral" variant="outline" size="sm" label="edited" />
              <UBadge v-if="hit.deleted" color="error" variant="subtle" size="sm" label="deleted" />
            </p>
            <p v-if="hit.parent" class="mt-0.5 text-sm text-muted">
              In thread<span v-if="hit.parent.text"> · {{ hit.parent.text }}</span>
              <span v-if="hit.parent.deleted"> · parent deleted</span>
            </p>
            <p v-else-if="hit.replyCount" class="mt-0.5 text-sm text-muted">{{ hit.replyCount }} {{ hit.replyCount === 1 ? 'reply' : 'replies' }}</p>
            <p class="mt-2 leading-normal break-words whitespace-pre-wrap">{{ hit.text || 'No text.' }}</p>
            <p v-if="hit.files.length" class="mt-1 text-sm text-muted">{{ hit.files.map(file => file.name || file.title || 'file').join(', ') }}</p>
            <UButton
              v-if="hit.permalink"
              class="mt-2 px-0 font-bold"
              variant="link"
              trailing-icon="i-lucide-external-link"
              label="Open in Slack"
              :to="hit.permalink"
              target="_blank"
              rel="noopener noreferrer"
            />
          </li>
        </ol>
      </template>
    </section>
  </div>
</template>
