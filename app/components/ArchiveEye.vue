<script setup lang="ts">
const props = defineProps<{ noResults?: boolean }>()
const closed = ref(false)
watch(() => props.noResults, (noResults) => { closed.value = noResults })

const eye = ref<SVGSVGElement | null>(null)
const offset = ref({ x: 0, y: 0 })
let motion: MediaQueryList | undefined

function resetGaze () {
  offset.value = { x: 0, y: 0 }
}

function lookAt (clientX: number, clientY: number) {
  if (!eye.value || motion?.matches) return
  const bounds = eye.value.getBoundingClientRect()
  const x = clientX - (bounds.left + bounds.width * 125 / 240)
  const y = clientY - (bounds.top + bounds.height * 56 / 120)
  const distance = Math.max(85, Math.hypot(x, y))
  offset.value = { x: 17 * x / distance, y: 8 * y / distance }
}

function followPointer (event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  closed.value = false
  lookAt(event.clientX, event.clientY)
}

defineExpose({ lookAt })

onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', resetGaze)
  window.addEventListener('pointermove', followPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', resetGaze)
  window.addEventListener('blur', resetGaze)
})

onBeforeUnmount(() => {
  motion?.removeEventListener('change', resetGaze)
  window.removeEventListener('pointermove', followPointer)
  document.documentElement.removeEventListener('pointerleave', resetGaze)
  window.removeEventListener('blur', resetGaze)
})
</script>

<template>
  <svg ref="eye" class="archive-eye" width="200" height="100" aria-hidden="true" viewBox="0 0 240 120">
    <defs>
      <pattern id="lines" width="5" height="5" patternUnits="userSpaceOnUse">
        <path d="M0 4h5" style="stroke: var(--accent)" stroke-width="1.4"/>
      </pattern>
      <clipPath id="eyelid-clip">
        <use href="#eye"/>
      </clipPath>
    </defs>
    <path fill="none" style="stroke: var(--accent)" stroke-width="2" d="M120 4 233 60 120 116 7 60Z"/>
    <path id="eye" style="fill: var(--brand-orange)" d="M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z"/>
    <use href="#eye" fill="url(#lines)" style="fill:url(#lines)"/>
    <g :transform="`translate(${offset.x} ${offset.y})`">
      <circle cx="125" cy="56" r="28" style="fill: var(--ink)"/>
      <circle cx="125" cy="56" r="23" fill="none" style="stroke: var(--brand-orange)" stroke-width="1.5"/>
      <path style="fill: var(--paper)" d="M130 42h13v5h-13z"/>
    </g>
    <g clip-path="url(#eyelid-clip)">
      <g class="eyelid" :class="{ 'eyelid-closed': closed }">
        <rect x="36" y="19" width="168" height="83" class="eyelid-cover"/>
        <path d="M37 59q83 44 166 0" class="eyelid-seam"/>
      </g>
    </g>
    <path d="M18 60h9m186 0h9" style="stroke: var(--accent)" stroke-width="2"/>
  </svg>
</template>


<style scoped>
.eyelid { transform: translateY(-84px); }
.eyelid-closed { transform: translateY(0); }
.eyelid-cover { fill: var(--accent); }
.eyelid-seam { fill: none; stroke: var(--paper); stroke-width: 2; }

@media (prefers-reduced-motion: no-preference) {
  .eyelid { transition: transform 180ms ease-out; }
  .eyelid:not(.eyelid-closed) { animation: idle-blink 7s ease-in-out infinite; }

  @keyframes idle-blink {
    0%, 96%, 100% { transform: translateY(-84px); }
    98% { transform: translateY(0); }
  }
}
</style>
