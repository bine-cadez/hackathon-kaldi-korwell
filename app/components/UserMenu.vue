<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// Account menu at the end of the header. Hidden when the server has no lock:
// there is no one to show and nothing to sign out of.
const session = useSession()
const name = computed(() => session.value.email ? displayName(session.value.email) : 'Shared access')

const items = computed<DropdownMenuItem[][]>(() => [
  [{
    type: 'label',
    label: name.value,
    description: session.value.email ?? 'Unlocked with the shared password',
    avatar: session.value.email ? { alt: name.value, ui: AVATAR_UI } : { icon: 'i-lucide-key-round', ui: AVATAR_UI }
  }],
  [{ label: 'Profile', icon: 'i-lucide-user', to: '/profile' }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => { signOut() } }]
])
</script>

<template>
  <UDropdownMenu
    v-if="session.auth !== 'open'"
    :items="items"
    :content="{ align: 'end' }"
    :ui="{ content: 'min-w-60', itemDescription: '[overflow-wrap:anywhere]' }"
  >
    <UButton color="neutral" variant="ghost" class="rounded-full p-0.5" :aria-label="`Account: ${session.email ?? 'shared password'}`">
      <UAvatar v-if="session.email" :alt="name" size="md" :ui="AVATAR_UI" />
      <UAvatar v-else icon="i-lucide-key-round" size="md" :ui="AVATAR_UI" />
    </UButton>
  </UDropdownMenu>
</template>
