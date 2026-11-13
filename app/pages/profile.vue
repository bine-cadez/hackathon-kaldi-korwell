<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { documentListQuery, documentPath } from '~/queries/documents'
import { DEFAULT_LIBRARY_FILTERS, libraryRouteQuery } from '~/utils/libraryFilters'

useHead({ title: 'Profile' })

const session = useSession()
const email = computed(() => session.value.email)
const name = computed(() => email.value ? displayName(email.value) : '')

// Uploads are attributed only to a verified Access email, so only then is
// there a "your documents" list.
const request = useRequestFetch()
const filters = computed(() => ({ ...DEFAULT_LIBRARY_FILTERS, uploadedBy: email.value ?? '', pageSize: 10 }))
const { data: uploads, error: uploadsError, refetch: retryUploads } = useQuery(() => ({
  ...documentListQuery({ filters: filters.value, request }),
  enabled: Boolean(email.value)
}))
const allUploadsLink = computed(() => ({ path: '/library', query: libraryRouteQuery({ ...DEFAULT_LIBRARY_FILTERS, uploadedBy: email.value ?? '' }) }))

const signingOut = ref(false)
function onSignOut () {
  signingOut.value = true
  signOut()
}
</script>

<template>
  <main>
    <section class="studio-section" aria-labelledby="profile-title">
      <p class="eyebrow">Profile</p>
      <div class="min-w-0">
        <template v-if="session.auth === 'cloudflare-access' && email">
          <div class="flex flex-wrap items-center gap-5">
            <UAvatar :alt="name" size="3xl" :ui="AVATAR_UI" />
            <div class="min-w-0">
              <h1 id="profile-title" class="text-[2rem] leading-tight font-light">{{ name }}</h1>
              <p class="mt-1 text-lg text-muted [overflow-wrap:anywhere]">{{ email }}</p>
            </div>
          </div>
          <p class="mt-6 max-w-2xl text-lg leading-relaxed">
            You signed in through Cloudflare Access with your Kaldi email. Documents you add are recorded under this address.
          </p>
        </template>
        <template v-else-if="session.auth === 'password'">
          <h1 id="profile-title" class="text-[2rem] leading-tight font-light">Shared access</h1>
          <p class="mt-4 max-w-2xl text-lg leading-relaxed">
            You unlocked Korwell with the shared password. It doesn’t know who you are, so documents you add aren’t linked to you.
          </p>
        </template>
        <template v-else>
          <h1 id="profile-title" class="text-[2rem] leading-tight font-light">No sign-in</h1>
          <p class="mt-4 max-w-2xl text-lg leading-relaxed">
            Korwell is open on this server. There is no account to show and nothing to sign out of.
          </p>
        </template>

        <UButton
          v-if="session.auth !== 'open'"
          class="mt-6 uppercase"
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          label="Sign out"
          :loading="signingOut"
          @click="onSignOut"
        />
      </div>
    </section>

    <section v-if="email" class="studio-section border-t border-default" aria-labelledby="profile-uploads">
      <h2 id="profile-uploads" class="text-[2rem] leading-tight font-light">Your documents</h2>
      <div class="min-w-0">
        <ErrorState v-if="uploadsError" :error="uploadsError" title="Couldn’t load your documents" @retry="retryUploads()" />
        <DocListSkeleton v-else-if="!uploads" :rows="4" />
        <div v-else-if="!uploads.total">
          <p class="text-lg text-muted">You haven’t added any documents yet.</p>
          <UButton to="/feed" class="mt-4 uppercase" icon="i-lucide-plus" label="Add document" />
        </div>
        <template v-else>
          <p class="text-muted">{{ uploads.total }} {{ uploads.total === 1 ? 'document' : 'documents' }}, newest first.</p>
          <ul class="mt-3 max-w-3xl divide-y divide-default border-y border-default">
            <li v-for="doc in uploads.documents" :key="doc.id">
              <NuxtLink
                :to="documentPath(doc.id)"
                class="flex items-baseline justify-between gap-4 py-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span class="min-w-0 [overflow-wrap:anywhere]">{{ doc.title }}</span>
                <span class="shrink-0 text-sm text-muted tabular-nums">{{ formatShortDate(doc.createdAt) }}</span>
              </NuxtLink>
            </li>
          </ul>
          <UButton
            v-if="uploads.total > uploads.documents.length"
            :to="allUploadsLink"
            class="mt-4 px-0 text-link underline underline-offset-[0.2em]"
            variant="link"
            :label="`See all ${uploads.total} in the Library`"
          />
        </template>
      </div>
    </section>
  </main>
</template>
