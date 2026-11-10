<script setup lang="ts">
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
  if (event.pointerType === 'mouse') lookAt(event.clientX, event.clientY)
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
        <path d="M0 4h5" stroke="#593d14" stroke-width="1.4"/>
      </pattern>
    </defs>
    <path fill="none" stroke="#593d14" stroke-width="2" d="M120 4 233 60 120 116 7 60Z"/>
    <path id="eye" fill="#fd4e1f" d="M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z"/>
    <use href="#eye" fill="url(#lines)" style="fill:url(#lines)"/>
    <g :transform="`translate(${offset.x} ${offset.y})`">
      <circle cx="125" cy="56" r="28" fill="#382811"/>
      <circle cx="125" cy="56" r="23" fill="none" stroke="#fd4e1f" stroke-width="1.5"/>
      <path fill="#f2f0ed" d="M130 42h13v5h-13z"/>
    </g>
    <path d="M18 60h9m186 0h9" stroke="#593d14" stroke-width="2"/>
  </svg>
</template>
