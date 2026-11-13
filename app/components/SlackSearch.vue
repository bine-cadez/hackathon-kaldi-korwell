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
  <div class="slack-search">
    <form class="search-form" role="search" novalidate @submit.prevent="runSearch">
      <div class="search-bar">
        <label class="sr-only" for="slack-query">Search Slack messages</label>
        <input id="slack-query" v-model="query" :aria-invalid="queryInvalid || undefined" type="text" name="query" placeholder="Search Slack messages…" @input="queryInvalid = false">
        <button class="search-submit" type="submit" :disabled="searching" :aria-label="searching ? 'Searching…' : 'Search Slack'">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="2"/>
            <path d="m15 15 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="search-filters">
        <label>
          Channel
          <input v-model="channel" type="text" name="channel" maxlength="200" placeholder="Name or channel ID">
        </label>
        <label>
          Person
          <input v-model="user" type="text" name="user" maxlength="200" placeholder="Name or user ID">
        </label>
        <label>
          From
          <input v-model="fromDate" type="date" name="from">
        </label>
        <label>
          To
          <input v-model="toDate" type="date" name="to">
        </label>
      </div>
      <p class="meta search-filter-note">Dates include the whole day, in UTC. Deleted messages stay in the archive and are marked deleted.</p>
    </form>
    <p v-if="queryInvalid" class="query-feedback" role="alert">Enter a search term or a channel, person, or date.</p>
    <section v-if="searched" class="search-results" aria-label="Slack results" :aria-busy="searching">
      <template v-if="searching">
        <p role="status" class="sr-only">Searching Slack…</p>
        <ResultSkeleton />
      </template>
      <ErrorState v-else-if="searchError" :error="searchError" title="Slack search didn’t finish" @retry="runSearch()" />
      <p v-else-if="!matches.length" role="status">No Slack messages matched.</p>
      <template v-else>
        <h2>From Slack</h2>
        <ol class="results">
          <li v-for="hit in matches" :key="hit.channelId + hit.ts" class="result">
            <h3>{{ author(hit) }}</h3>
            <p class="meta">
              <span>{{ hit.channelName ? '#' + hit.channelName : hit.channelId }}</span>
              <span> · {{ when(hit) }}</span>
              <span v-if="hit.editedAt"> · edited</span>
              <span v-if="hit.deleted"> · deleted</span>
            </p>
            <p v-if="hit.parent" class="meta">
              In thread<span v-if="hit.parent.text"> · {{ hit.parent.text }}</span>
              <span v-if="hit.parent.deleted"> · parent deleted</span>
            </p>
            <p v-else-if="hit.replyCount" class="meta">{{ hit.replyCount }} {{ hit.replyCount === 1 ? 'reply' : 'replies' }}</p>
            <p class="chunk">{{ hit.text || 'No text.' }}</p>
            <p v-if="hit.files.length" class="meta">{{ hit.files.map(file => file.name || file.title || 'file').join(', ') }}</p>
            <a v-if="hit.permalink" class="ghost slack-permalink" :href="hit.permalink" target="_blank" rel="noopener noreferrer">Open in Slack</a>
          </li>
        </ol>
      </template>
    </section>
  </div>
</template>
