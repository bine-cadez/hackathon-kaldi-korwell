<script setup lang="ts">
// Light Kaldi header shared by the app and the error page. The logo is the
// archive eye: it blinks, follows the pointer, and blinks faster while Korwell
// answers. `external` makes the logo a plain link (a full page load), which the
// error page needs.
defineProps<{ external?: boolean }>()
const asking = useState('korwell-asking', () => false)
const startNewChat = useStartNewChat()
</script>

<template>
  <header class="relative z-10 flex flex-wrap items-center gap-x-10 gap-y-3 border-b border-default bg-paper px-[clamp(1rem,5vw,4.5rem)] py-3 shadow-[0_1px_6px_rgb(89_61_20/0.06)]">
    <NuxtLink
      class="flex items-center gap-3 rounded-full font-serif text-[1.65rem] font-semibold tracking-tight text-kaldi-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      to="/"
      :external="external"
      @click="startNewChat"
    >
      <ArchiveEye class="logo-eye" :searching="asking" />
      Korwell
    </NuxtLink>
    <slot />
  </header>
</template>
