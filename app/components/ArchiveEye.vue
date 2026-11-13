<script setup lang="ts">
// The mood is how the eye reacts to what the page is doing (the upload page sets
// it): hungry for a dragged file, reading while saving, pleased once fed, and
// alarmed by an error. Only the lid and pupil move; the drawing stays the same.
type EyeMood = 'idle' | 'hungry' | 'reading' | 'pleased' | 'alarmed'
// `appetite` (0 to 1) widens the pupil a little as the archive fills.
// `arrive`: on the first full page load of a visit, the eye flies out of the
// header logo to its place, so people notice it.
const props = defineProps<{ noResults?: boolean, searching?: boolean, blackHole?: boolean, mood?: EyeMood, appetite?: number, arrive?: boolean }>()
const moodClass = computed(() => props.mood && props.mood !== 'idle' && !props.blackHole ? `mood-${props.mood}` : undefined)
const pupilGrow = computed(() => Math.max(0, Math.min(1, props.appetite ?? 0)) * 0.12)
const closed = ref(false)
const eyeId = useId()
const irisId = `${eyeId}-iris`
const linesId = `${eyeId}-lines`
const eyelidId = `${eyeId}-eyelid`
watch(() => props.noResults, (noResults) => { closed.value = noResults })

const eye = ref<SVGSVGElement | null>(null)
const offset = ref({ x: 0, y: 0 })
let motion: MediaQueryList | undefined

// Each eye starts its blink cycle at a different point, so two eyes on a page
// (the header logo and the page eye) do not blink together.
const blinkOffset = ref('0s')
const blinking = ref(false)
let blinkTimer: ReturnType<typeof setTimeout> | undefined

function resetGaze () {
  offset.value = { x: 0, y: 0 }
  lastLook = { x: NaN, y: NaN }
}

watch(() => props.blackHole, (open) => { if (open) resetGaze() })
// While reading, the pupil scans lines by itself instead of following the pointer.
watch(() => props.mood, (mood) => { if (mood === 'reading') resetGaze() })

let lastLook = { x: NaN, y: NaN }

function lookAt (clientX: number, clientY: number) {
  if (!eye.value || motion?.matches || props.blackHole || props.mood === 'reading') return
  // dragover repeats while the pointer is still; skip the layout read then.
  if (clientX === lastLook.x && clientY === lastLook.y) return
  lastLook = { x: clientX, y: clientY }
  const bounds = eye.value.getBoundingClientRect()
  const x = clientX - (bounds.left + bounds.width * 125 / 240)
  const y = clientY - (bounds.top + bounds.height * 56 / 120)
  const distance = Math.max(85, Math.hypot(x, y))
  offset.value = { x: 17 * x / distance, y: 8 * y / distance }
}

// One quick blink, as an acknowledgement (the upload page uses it for "file added").
function blink () {
  if (motion?.matches) return
  clearTimeout(blinkTimer)
  blinking.value = true
  blinkTimer = setTimeout(() => { blinking.value = false }, 360)
}

function followPointer (event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  closed.value = false
  lookAt(event.clientX, event.clientY)
}

defineExpose({ lookAt, blink })

const nuxtApp = useNuxtApp() as ReturnType<typeof useNuxtApp> & { $isFirstPage?: () => boolean }
const arrivedKey = 'korwell-eye-arrived'
let arrival: Animation | undefined
let arrivalTimer: ReturnType<typeof setTimeout> | undefined

// Only on a full page load (later visits get the page-to-page glide instead),
// and once per tab.
function arriveFromLogo () {
  const svg = eye.value
  const logo = document.querySelector('.logo-eye')
  if (!svg || !logo || logo === svg || motion?.matches || typeof svg.animate !== 'function') return
  try {
    if (sessionStorage.getItem(arrivedKey)) return
    sessionStorage.setItem(arrivedKey, '1')
  } catch {
    // Without storage it plays on every full load, which is fine.
  }
  const from = logo.getBoundingClientRect()
  const to = svg.getBoundingClientRect()
  if (!from.width || !to.width) return
  const dx = from.left - to.left
  const dy = from.top - to.top
  const scale = from.width / to.width
  // It leaves the logo, swoops down past the middle of the line, then settles.
  const mid = scale + (1 - scale) * 0.75
  svg.style.position = 'relative'
  svg.style.zIndex = '30'
  svg.style.transformOrigin = '0 0'
  arrival = svg.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.85 },
    { offset: 0.62, transform: `translate(${dx * 0.28}px, ${dy * 0.42 + 26}px) scale(${mid})`, opacity: 1 },
    { transform: 'none', opacity: 1 }
  ], { duration: 1500, delay: 350, easing: 'cubic-bezier(0.55, 0, 0.3, 1)', fill: 'backwards' })
  arrival.finished.then(() => {
    svg.style.removeProperty('position')
    svg.style.removeProperty('z-index')
    svg.style.removeProperty('transform-origin')
    blink()
  }, () => {})
}

onMounted(() => {
  if (props.arrive && nuxtApp.$isFirstPage?.()) {
    // Wait for the page's layout to settle before measuring where the eye lands.
    // A timer, not requestAnimationFrame: frames can be held back while loading.
    motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    arrivalTimer = setTimeout(arriveFromLogo, 60)
  }
  blinkOffset.value = `-${(Math.random() * 19).toFixed(2)}s`
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', resetGaze)
  window.addEventListener('pointermove', followPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', resetGaze)
  window.addEventListener('blur', resetGaze)
})

onBeforeUnmount(() => {
  clearTimeout(arrivalTimer)
  arrival?.cancel()
  clearTimeout(blinkTimer)
  motion?.removeEventListener('change', resetGaze)
  window.removeEventListener('pointermove', followPointer)
  document.documentElement.removeEventListener('pointerleave', resetGaze)
  window.removeEventListener('blur', resetGaze)
})
</script>

<template>
  <svg
    ref="eye"
    class="archive-eye"
    width="200"
    height="100"
    aria-hidden="true"
    viewBox="0 0 240 120"
    :class="[{ 'black-hole-eye': blackHole }, moodClass]"
    :style="{ '--blink-offset': blinkOffset, '--pupil-grow': pupilGrow }"
  >
    <defs>
      <pattern :id="linesId" width="5" height="5" patternUnits="userSpaceOnUse">
        <path d="M0 4h5" style="stroke: var(--accent)" stroke-width="1.4"/>
      </pattern>
      <clipPath :id="eyelidId">
        <use :href="`#${irisId}`"/>
      </clipPath>
    </defs>
    <path fill="none" style="stroke: var(--accent)" stroke-width="2" d="M120 4 233 60 120 116 7 60Z"/>
    <path :id="irisId" style="fill: var(--brand-orange)" d="M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z"/>
    <use :href="`#${irisId}`" :style="{ fill: `url(#${linesId})` }"/>
    <g class="gaze" :style="{ transform: `translate(${offset.x}px, ${offset.y}px)` }">
      <g class="pupil">
        <circle cx="125" cy="56" r="28" style="fill: var(--ink)"/>
        <circle cx="125" cy="56" r="23" fill="none" style="stroke: var(--brand-orange)" stroke-width="1.5"/>
        <path style="fill: var(--paper)" d="M130 42h13v5h-13z"/>
      </g>
      <Transition name="hole">
        <circle v-if="blackHole" class="black-hole" cx="125" cy="56" r="36" />
      </Transition>
    </g>
    <g :clip-path="`url(#${eyelidId})`">
      <g class="eyelid" :class="{ 'eyelid-closed': closed, 'eyelid-searching': searching, 'eyelid-blink': blinking }">
        <rect x="36" y="19" width="168" height="83" class="eyelid-cover"/>
        <path d="M37 59q83 44 166 0" class="eyelid-seam"/>
      </g>
    </g>
    <path d="M18 60h9m186 0h9" style="stroke: var(--accent)" stroke-width="2"/>
  </svg>
</template>


<style scoped>
.black-hole {
  fill: #090705;
  transform-box: fill-box;
  transform-origin: center;
  animation: black-hole-open 950ms ease-out both;
}
/* The hole shrinks shut while the eye flies home, instead of vanishing. */
.black-hole.hole-leave-active { animation: black-hole-close 620ms cubic-bezier(0.5, 0, 0.9, 0.4) both; }
@keyframes black-hole-open {
  from { transform: scale(0.1); }
  to { transform: scale(1); }
}
@keyframes black-hole-close {
  from { transform: scale(1); }
  to { transform: scale(0); }
}
.eyelid { transform: translateY(-84px); }
.eyelid-closed { transform: translateY(0); }
.eyelid-cover { fill: var(--accent); }
.eyelid-seam { fill: none; stroke: var(--paper); stroke-width: 2; }

/* Moods, as still poses. With reduced motion these are all that change. */
.pupil {
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(calc(1 + var(--pupil-grow, 0)));
}
.archive-eye.mood-hungry .eyelid:not(.eyelid-closed) { transform: translateY(-62px); }
.archive-eye.mood-reading .eyelid:not(.eyelid-closed) { transform: translateY(-70px); }
.archive-eye.mood-alarmed .eyelid:not(.eyelid-closed) { transform: translateY(-66px); }
.mood-hungry .pupil { transform: scale(calc(1.14 + var(--pupil-grow, 0))); }
.mood-pleased .pupil { transform: scale(calc(1.1 + var(--pupil-grow, 0))); }
.mood-alarmed .pupil { transform: scale(0.86); }

@media (prefers-reduced-motion: no-preference) {
  .eyelid { transition: transform 180ms ease-out; }
  /* The gaze glides after the pointer instead of jumping to it. */
  .gaze { transition: transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1); }
  .pupil { transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1); }

  /* Idle: three blinks at uneven intervals over 19s, one of them a double. */
  .archive-eye:not(.black-hole-eye) .eyelid:not(.eyelid-closed) {
    animation: idle-blink 19s ease-in-out var(--blink-offset, 0s) infinite;
  }
  .archive-eye .eyelid.eyelid-searching:not(.eyelid-closed) { animation: search-blink 1.2s ease-in-out infinite; }
  .archive-eye .eyelid.eyelid-blink:not(.eyelid-closed) { animation: quick-blink 320ms ease-in-out; }

  /* A mood holds the lid still (an unblinking stare) unless it has its own move. */
  .archive-eye[class*="mood-"] .eyelid:not(.eyelid-closed) { animation: none; transition-duration: 320ms; }
  /* Fed: the pupil gulps, then one slow, satisfied blink. */
  .archive-eye.mood-pleased .eyelid:not(.eyelid-closed) { animation: slow-blink 900ms ease-in-out both; }
  .mood-pleased .pupil { animation: gulp 800ms ease-out both; }
  /* Error: the lid snaps shut, then stays narrowed. */
  .archive-eye.mood-alarmed .eyelid:not(.eyelid-closed) { animation: flinch 700ms ease-out both; }
  .mood-alarmed .pupil { animation: recoil 520ms 120ms ease-out both; }
  /* Saving: the pupil reads lines, left to right, then back to the start. */
  .mood-reading .pupil { animation: read-in 250ms ease-out both, read-lines 1100ms 250ms ease-in-out infinite; }

  @keyframes search-blink {
    0%, 70%, 100% { transform: translateY(-84px); }
    85% { transform: translateY(0); }
  }

  @keyframes idle-blink {
    0%, 15.4%, 16.8%, 46.4%, 47.8%, 48.4%, 49.8%, 80.4%, 81.8%, 100% { transform: translateY(-84px); }
    16%, 47%, 49%, 81% { transform: translateY(0); }
  }

  @keyframes quick-blink {
    0%, 100% { transform: translateY(-84px); }
    40% { transform: translateY(0); }
  }

  @keyframes slow-blink {
    0%, 100% { transform: translateY(-84px); }
    35%, 50% { transform: translateY(0); }
  }

  @keyframes gulp {
    0% { transform: scale(calc(1 + var(--pupil-grow, 0))); }
    30% { transform: scale(calc(1.3 + var(--pupil-grow, 0))); }
    100% { transform: scale(calc(1.1 + var(--pupil-grow, 0))); }
  }

  @keyframes flinch {
    0% { transform: translateY(-84px); }
    14%, 34% { transform: translateY(0); }
    100% { transform: translateY(-66px); }
  }

  @keyframes recoil {
    0%, 100% { transform: scale(0.86); }
    20% { transform: translateX(-4px) scale(0.86); }
    45% { transform: translateX(4px) scale(0.86); }
    70% { transform: translateX(-2px) scale(0.86); }
  }

  @keyframes read-in {
    to { transform: translateX(-11px) scale(calc(1 + var(--pupil-grow, 0))); }
  }

  @keyframes read-lines {
    0%, 90%, 100% { transform: translateX(-11px) scale(calc(1 + var(--pupil-grow, 0))); }
    78% { transform: translateX(11px) scale(calc(1 + var(--pupil-grow, 0))); }
  }
}
</style>
