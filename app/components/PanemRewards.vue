<script setup lang="ts">
import { EYE_COLOR_TIME, EYE_COUNT, pullPath, REFILL_TIME, RIPPLE_TIME, UPLOAD_COLOR_TIME } from '~/utils/eyeField'

const props = defineProps<{
  anchor: HTMLElement | null
  form: HTMLFormElement | null
  rewardsEnabled: boolean
  saving: boolean
  demo: boolean
  replay: boolean
}>()
const emit = defineEmits<{
  eyeTravel: [travel: { x: number, y: number, scale: number, returning: boolean, duration: number } | null]
  eyeBlackHole: [open: boolean]
  appetite: [filled: number]
}>()
const eyeCount = EYE_COUNT
const demoGoal = 3_000
const wordsPerEye = demoGoal / eyeCount
const roundLength = 5
const pullTime = 5400
const travelTime = 1750
const returnTime = 1100
const woltFlightTime = 4000
const fillTime = 550
const eyeColorTime = EYE_COLOR_TIME
const refillTime = REFILL_TIME
const uploadColorTime = UPLOAD_COLOR_TIME
const rippleTime = RIPPLE_TIME
const vortex = ref({ x: 0, y: 0 })
const woltFlying = ref(false)
const format = new Intl.NumberFormat('en')
const introKey = 'korwell-panem-feed-intro-seen'
const progressKey = 'korwell-panem-local-progress'
const intro = ref<'waiting' | 'scattering' | 'done'>('waiting')
const field = ref<HTMLElement | null>(null)
const fieldSize = ref({ width: 1200, height: 900 })
const source = ref({ x: 50, y: 0 })
const formBox = ref({ x: 0, y: 0, width: 0, height: 0 })
const borderEyes = [
  { side: 'top', position: 0.27, angle: -16, width: 36, opacity: 0.52 },
  { side: 'left', position: 0.29, angle: 13, width: 34, opacity: 0.42 },
  { side: 'right', position: 0.47, angle: -11, width: 40, opacity: 0.55 },
  { side: 'left', position: 0.79, angle: -18, width: 39, opacity: 0.48 },
  { side: 'bottom', position: 0.72, angle: 12, width: 33, opacity: 0.44 }
] as const

function borderEyePosition (eye: typeof borderEyes[number]) {
  const { x, y, width, height } = formBox.value
  switch (eye.side) {
    case 'top': return { x: x + width * eye.position, y: y }
    case 'bottom': return { x: x + width * eye.position, y: y + height + 2 }
    case 'left': return { x: x - 6, y: y + height * eye.position }
    case 'right': return { x: x + width + 6, y: y + height * eye.position }
  }
}

const words = ref(0)
const clicks = ref(0)
const lastAdded = ref(0)
type RewardPhase = 'collecting' | 'full' | 'swallowing' | 'wolt' | 'voucher'
const phase = ref<RewardPhase>('collecting')
const preview = ref<{ previousPhase: RewardPhase, filledEyes: number, voucher: string } | null>(null)
const uploadWords = ref(0)
// True while a saved document's colour ripples out from the main eye.
const uploadFill = ref(false)
let finishUploadColor: (() => void) | undefined
const showingProgress = computed(() => phase.value === 'collecting' || phase.value === 'full' || phase.value === 'swallowing')
const refillStart = computed(() => preview.value?.filledEyes ?? (showingProgress.value ? (words.value + uploadWords.value) / wordsPerEye : 0))
const ending = computed(() => phase.value === 'full' || phase.value === 'swallowing' || woltFlying.value)
const canRefill = computed(() => intro.value === 'done' && !props.saving && !ending.value &&
  (!props.rewardsEnabled || !preview.value))
const voucherReference = ref('')
const voucherUrl = computed(() => '/api/demo/panem/' + (preview.value?.voucher ?? voucherReference.value) + '.svg')
const fillButton = ref<{ $el: HTMLElement } | null>(null)
const refillButton = ref<HTMLButtonElement | null>(null)
const woltTarget = ref<HTMLElement | null>(null)
const woltButton = ref<HTMLButtonElement | null>(null)
const voucherTicket = ref<HTMLAnchorElement | null>(null)
let observer: ResizeObserver | undefined
let introTimer: ReturnType<typeof setTimeout> | undefined
let revealTimer: ReturnType<typeof setTimeout> | undefined
let woltFlight: Animation | undefined
let followFrame = 0

function measureField () {
  const bounds = field.value?.getBoundingClientRect()
  const eye = props.anchor?.querySelector('.archive-eye')?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  const form = props.form?.getBoundingClientRect()
  if (form) {
    formBox.value = { x: form.left - bounds.left, y: form.top - bounds.top, width: form.width, height: form.height }
  } else {
    formBox.value = { x: 0, y: 0, width: 0, height: 0 }
  }
  fieldSize.value = { width: bounds.width, height: bounds.height }
  if (eye) {
    source.value = {
      x: (eye.left + eye.width / 2 - bounds.left) * 100 / bounds.width,
      y: (eye.top + eye.height / 2 - bounds.top) * 100 / bounds.height
    }
  }
}

// The five eyes around the form follow the same pull as the canvas eyes, a little earlier.
function pullStyle (x: number, y: number, index: number) {
  const pull = pullPath(x, y, vortex.value, eyeCount + index, true)
  return {
    '--pull-x': pull.dx + 'px',
    '--pull-y': pull.dy + 'px',
    '--curve-x': pull.curveX + 'px',
    '--curve-y': pull.curveY + 'px',
    '--curve-spin': pull.curveSpin + 'deg',
    '--pull-spin': pull.pullSpin + 'deg',
    '--pull-delay': pull.delay + 'ms',
    '--pull-duration': pull.duration + 'ms'
  }
}

// How far the colour has to travel from the main eye to the farthest corner.
const rippleReach = computed(() => {
  const { width, height } = fieldSize.value
  const x = source.value.x * width / 100
  const y = source.value.y * height / 100
  return Math.max(1, Math.hypot(Math.max(x, width - x), Math.max(y, height - y)))
})

// The main eye's pupil widens a little as the eyes fill (ArchiveEye's appetite).
watch(refillStart, (filled) => emit('appetite', Math.min(1, filled / eyeCount)), { immediate: true })

function borderEyeStyle (eye: typeof borderEyes[number], index: number) {
  const { x, y } = borderEyePosition(eye)
  return {
    left: x + 'px',
    top: y + 'px',
    width: eye.width + 'px',
    '--rest-opacity': eye.opacity,
    '--angle': eye.angle + 'deg',
    ...(phase.value === 'swallowing' ? pullStyle(x, y, index) : {})
  }
}

watch(() => props.form, (form, previousForm) => {
  if (previousForm) observer?.unobserve(previousForm)
  if (form) observer?.observe(form)
  measureField()
}, { flush: 'post' })

onMounted(() => {
  measureField()
  if (field.value) {
    observer = new ResizeObserver(measureField)
    observer.observe(field.value)
    if (props.form) observer.observe(props.form)
  }

  if (props.rewardsEnabled && !props.demo) {
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey) ?? '{}')
      if (Number.isSafeInteger(saved.words) && saved.words >= 0) words.value = saved.words
      if (words.value >= demoGoal) {
        voucherReference.value = /^DEMO-[0-9A-F]{8}$/.test(saved.voucher) ? saved.voucher : ''
        phase.value = voucherReference.value ? 'voucher' : 'wolt'
      }
    } catch {
      // Progress still works for this visit if storage is unavailable.
    }
  }

  try {
    if (!props.replay && localStorage.getItem(introKey)) {
      intro.value = 'done'
      return
    }
  } catch {
    // The intro can still play if this browser does not allow storage.
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishIntro()
    return
  }

  // The shared ArchiveEye transition takes 0.7s. Pause briefly after it lands.
  playIntro(1000)
})

function playIntro (delay: number) {
  clearTimeout(introTimer)
  intro.value = 'waiting'
  introTimer = setTimeout(() => {
    measureField()
    intro.value = 'scattering'
    introTimer = setTimeout(finishIntro, 2000)
  }, delay)
}

function replayIntro () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  props.anchor?.scrollIntoView({ block: 'start', behavior: 'instant' })
  playIntro(500)
}

function finishIntro () {
  intro.value = 'done'
  try {
    localStorage.setItem(introKey, '1')
  } catch {
    // Private or restricted browsing can prevent persistence.
  }
}

function fillEyes () {
  if (phase.value !== 'collecting' || intro.value !== 'done') return
  const remaining = demoGoal - words.value
  clicks.value += 1
  const clicksLeft = roundLength - clicks.value
  // Reserve enough words for every remaining click. The last click adds the exact balance.
  const randomAmount = remaining / (clicksLeft + 1) * (0.65 + Math.random() * 0.7)
  lastAdded.value = clicksLeft ? Math.max(1, Math.min(remaining - clicksLeft, Math.round(randomAmount))) : remaining
  words.value += lastAdded.value
  if (clicksLeft) return

  revealReward()
}

function saveProgress () {
  if (props.demo) return
  try {
    localStorage.setItem(progressKey, JSON.stringify({ words: words.value, voucher: voucherReference.value }))
  } catch {
    // Progress still works for this visit if storage is unavailable.
  }
}

async function colorSavedDocument (wordCount: number) {
  if (wordCount <= 0) return

  // A completed preview can be cleared before showing this upload's progress.
  clearTimeout(introTimer)
  clearTimeout(revealTimer)
  if (intro.value !== 'done') finishIntro()
  const previousPhase = preview.value?.previousPhase ?? phase.value
  preview.value = null
  phase.value = 'collecting'
  await nextTick()

  if (props.rewardsEnabled && !props.demo) {
    lastAdded.value = wordCount
    words.value += wordCount
    saveProgress()
  } else {
    // A short upload should still light up enough eyes to be visible around the form.
    uploadWords.value = Math.max(wordCount, 24 * wordsPerEye)
  }

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    uploadFill.value = true
    await new Promise<void>((resolve) => {
      finishUploadColor = resolve
      revealTimer = setTimeout(resolve, uploadColorTime + 100)
    })
    finishUploadColor = undefined
    uploadFill.value = false
  }

  phase.value = previousPhase
}

defineExpose({ colorSavedDocument, ending })

function refillEyes () {
  if (!canRefill.value) return
  preview.value = { previousPhase: phase.value, filledEyes: showingProgress.value ? refillStart.value : 0, voucher: '' }
  revealReward(refillTime + eyeColorTime)
}

async function finishPreview () {
  if (!preview.value) return
  const { previousPhase } = preview.value
  phase.value = previousPhase === 'collecting' && words.value >= demoGoal ? 'wolt' : previousPhase
  preview.value = null
  await nextTick()
  refillButton.value?.focus({ preventScroll: true })
}

function revealReward (delay = fillTime) {
  phase.value = 'full'
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    void showWolt()
    return
  }

  revealTimer = setTimeout(moveEyeToCenter, delay)
}

function moveEyeToCenter () {
  if (intro.value !== 'done') finishIntro()
  clearTimeout(introTimer)
  props.anchor?.scrollIntoView({ block: 'start', behavior: 'instant' })
  const bounds = field.value?.getBoundingClientRect()
  const eye = props.anchor?.querySelector('.archive-eye')?.getBoundingClientRect()
  if (!bounds || !eye?.width) {
    void showWolt()
    return
  }

  const visibleTop = Math.max(bounds.top, 0)
  const visibleBottom = Math.min(bounds.bottom, window.innerHeight)
  vortex.value = {
    x: bounds.width / 2,
    y: (visibleTop + visibleBottom) / 2 - bounds.top
  }
  const travel = {
    x: vortex.value.x + bounds.left - (eye.left + eye.width * 125 / 240),
    y: vortex.value.y + bounds.top - (eye.top + eye.height * 56 / 120),
    scale: Math.min(384, bounds.width * 0.72) / eye.width,
    returning: false,
    duration: travelTime
  }
  emit('eyeTravel', travel)

  revealTimer = setTimeout(() => {
    phase.value = 'swallowing'
    emit('eyeBlackHole', true)
    revealTimer = setTimeout(() => {
      void flyWoltIntoBanner(() => {
        emit('eyeBlackHole', false)
        emit('eyeTravel', { ...travel, returning: true, duration: returnTime })
      })
    }, pullTime)
  }, travelTime)
}

async function flyWoltIntoBanner (returnEye: () => void) {
  woltFlying.value = true
  phase.value = 'wolt'
  await nextTick()

  const target = woltTarget.value
  const bounds = field.value?.getBoundingClientRect()
  if (target && bounds && typeof target.animate === 'function') {
    const slot = target.getBoundingClientRect()
    const slotX = slot.left + slot.width / 2
    const slotY = slot.top + slot.height / 2
    const startX = bounds.left + vortex.value.x - slotX
    const startY = bounds.top + vortex.value.y - slotY
    const floor = bounds.bottom - slot.bottom
    const bounceX = startX * 0.58
    const arc = Math.min(110, Math.max(46, (floor - startY) * 0.32))

    woltFlight = target.animate([
      { offset: 0, opacity: 0, transform: `translate(${startX}px, ${startY}px) scale(0.35)`, easing: 'ease-out' },
      { offset: 0.15, opacity: 1, transform: `translate(${startX + 28}px, ${startY - 26}px) rotate(22deg)`, easing: 'ease-in' },
      { offset: 0.48, opacity: 1, transform: `translate(${bounceX}px, ${floor}px) rotate(110deg) scale(1.1, 0.85)`, easing: 'ease-out' },
      { offset: 0.64, transform: `translate(${bounceX * 0.56}px, ${floor - arc}px) rotate(175deg)`, easing: 'ease-in' },
      { offset: 0.75, transform: `translate(${bounceX * 0.32}px, ${floor}px) rotate(215deg) scale(1.05, 0.93)`, easing: 'ease-out' },
      { offset: 0.89, transform: `translate(-5px, -16px) rotate(355deg)`, easing: 'ease-in-out' },
      { offset: 1, opacity: 1, transform: 'translate(0, 0) rotate(360deg)' }
    ], { duration: woltFlightTime, fill: 'both' })

    // Follow the falling icon only when it reaches the viewport's lower edge.
    function followIcon () {
      if (!target || !woltFlying.value) return
      const overflow = target.getBoundingClientRect().bottom - window.innerHeight
      if (overflow > 0) window.scrollBy({ top: overflow, behavior: 'instant' })
      followFrame = requestAnimationFrame(followIcon)
    }
    followFrame = requestAnimationFrame(followIcon)
    revealTimer = setTimeout(returnEye, woltFlightTime - returnTime)
    try {
      await woltFlight.finished
    } catch {
      // Navigation cancelled the flight and its pending timers.
      return
    }
    cancelAnimationFrame(followFrame)
    woltFlight.cancel()
    woltFlight = undefined
  } else {
    returnEye()
  }

  emit('eyeTravel', null)
  woltFlying.value = false
  await revealWoltResult()
}

async function showWolt () {
  phase.value = 'wolt'
  await revealWoltResult()
}

async function revealWoltResult () {
  if (preview.value) {
    await openVoucher()
    return
  }
  await nextTick()
  woltButton.value?.focus({ preventScroll: true })
}

async function openVoucher () {
  const reference = `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  if (preview.value) {
    preview.value.voucher = reference
  } else {
    voucherReference.value = reference
    saveProgress()
  }
  phase.value = 'voucher'
  await nextTick()
  voucherTicket.value?.focus({ preventScroll: true })
}

async function startNextRound () {
  words.value = props.demo ? 0 : Math.max(0, words.value - demoGoal)
  clicks.value = 0
  lastAdded.value = 0
  voucherReference.value = ''
  phase.value = words.value >= demoGoal ? 'wolt' : 'collecting'
  saveProgress()
  await nextTick()
  fillButton.value?.$el.focus()
}

onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(introTimer)
  clearTimeout(revealTimer)
  finishUploadColor?.()
  cancelAnimationFrame(followFrame)
  woltFlight?.cancel()
  emit('eyeTravel', null)
  emit('eyeBlackHole', false)
  emit('appetite', 0)
})
</script>

<template>
  <div class="panem">
    <svg class="eye-symbols" width="0" height="0" aria-hidden="true">
      <defs>
        <path id="panem-iris" d="M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z"/>
        <circle id="panem-pupil" cx="125" cy="56" r="28"/>
        <g id="panem-eye-lines" fill="none" stroke="var(--muted)" stroke-width="4">
          <path d="M120 4 233 60 120 116 7 60Z"/>
          <use href="#panem-iris"/>
          <use href="#panem-pupil"/>
          <circle cx="125" cy="56" r="21" stroke-width="3"/>
          <path d="M18 60h9m186 0h9M130 45h13"/>
        </g>
        <g id="panem-eye-color">
          <use href="#panem-iris" fill="var(--brand-orange)" />
          <use href="#panem-pupil" fill="var(--ink)" />
          <use href="#panem-eye-lines" />
          <path fill="var(--paper)" d="M130 42h13v5h-13z"/>
        </g>
      </defs>
    </svg>

    <div ref="field" class="eye-field" :class="{ swallowing: phase === 'swallowing' }">
      <EyeField
        :intro="intro"
        :origin="source"
        :filled="refillStart"
        :refill="Boolean(preview && showingProgress)"
        :ripple="uploadFill ? rippleReach : null"
        :hidden="!showingProgress"
        :vortex="phase === 'swallowing' ? vortex : null"
      />
      <span
        v-if="uploadFill"
        class="feed-ripple"
        :style="{ left: source.x + '%', top: source.y + '%', '--ripple-scale': rippleReach / 120 }"
      />
    </div>

    <div
      v-if="intro === 'done' && showingProgress && formBox.width"
      class="border-eye-field"
      :class="{ swallowing: phase === 'swallowing', refilled: preview }"
      aria-hidden="true"
    >
      <svg
        v-for="(eye, index) in borderEyes"
        :key="eye.side + eye.position"
        class="border-eye"
        viewBox="0 0 240 120"
        :style="borderEyeStyle(eye, index)"
      >
        <use href="#panem-eye-lines" />
        <g class="eye-color" style="--unfilled: 100%; --refill-delay: 1.8s"><use href="#panem-eye-color" /></g>
      </svg>
    </div>

    <section class="panem-banner" :class="{ 'is-swallowing': phase === 'swallowing' }" aria-labelledby="panem-title">
      <div class="panem-content">
        <h2 id="panem-title"><strong>Panem</strong> et circenses.</h2>

        <div v-if="showingProgress && rewardsEnabled" class="progress-card">
          <div class="progress-label">
            <span>Words toward lunch</span>
            <strong>{{ format.format(Math.min(words, demoGoal)) }} <span>/ {{ format.format(demoGoal) }}</span></strong>
          </div>
          <progress :value="words" :max="demoGoal" aria-label="Words toward lunch" />
          <div v-if="demo" class="progress-actions">
            <UButton ref="fillButton" size="sm" label="Fill the eyes" :disabled="saving || phase !== 'collecting' || intro !== 'done'" @click="fillEyes" />
            <span>{{ clicks }} of {{ roundLength }} demo clicks</span>
            <UButton class="replay-intro" size="sm" color="neutral" variant="outline" label="Replay intro" :disabled="saving || phase !== 'collecting' || intro !== 'done'" @click="replayIntro" />
          </div>
          <p class="sr-only" role="status">
            {{ lastAdded ? '+' + format.format(lastAdded) + (demo ? ' demo words' : ' words from your document') : '' }}
          </p>
        </div>

        <p v-else-if="showingProgress" class="panem-hint">Click the corner eye to preview the lunch reward.</p>

        <div v-else-if="phase === 'wolt'" class="wolt-reveal" :class="{ 'wolt-flying': woltFlying }">
          <div ref="woltTarget" class="wolt-disc">
            <img v-if="preview" src="/panem/wolt-disc.jpg" width="60" height="60" alt="Wolt">
            <button v-else ref="woltButton" class="wolt-button" type="button" :disabled="woltFlying" aria-label="Reveal your Wolt lunch voucher" @click="openVoucher">
              <img src="/panem/wolt-disc.jpg" width="60" height="60" alt="">
            </button>
          </div>
          <p v-if="!preview">Click Wolt to reveal your lunch.</p>
        </div>

        <div v-else class="ticket-actions">
          <img v-if="preview" class="wolt-disc ticket-wolt" src="/panem/wolt-disc.jpg" width="60" height="60" alt="Wolt">
          <a ref="voucherTicket" class="voucher-download" :href="voucherUrl" download>
            <img
              :src="voucherUrl + '?preview=1'"
              width="900"
              height="460"
              alt="One Lunch on Kaldi’s eyes. Demo only."
            >
            <span>Download sample coupon</span>
          </a>
          <UButton v-if="preview && rewardsEnabled" color="neutral" variant="outline" label="Back to progress" @click="finishPreview" />
          <UButton v-else-if="!preview" color="neutral" variant="outline" label="Start another round" @click="startNextRound" />
        </div>

      </div>
    </section>

    <button
      ref="refillButton"
      class="refill-eyes"
      type="button"
      :disabled="!canRefill"
      aria-label="Refill the eyes"
      title="Refill the eyes"
      @click="refillEyes"
    >
      <svg width="22" height="12" viewBox="0 0 240 120" aria-hidden="true">
        <use href="#panem-eye-lines" />
      </svg>
    </button>
    <span v-if="phase === 'swallowing'" class="sr-only" role="status">{{ preview ? 'All eyes filled. Playing the ending animation.' : 'All eyes filled. Revealing your lunch reward.' }}</span>
  </div>
</template>

<style scoped>
.panem { margin-top: auto; }
.panem-banner {
  border-block-start: 1px solid var(--line);
  background: var(--card);
}
.eye-symbols { position: absolute; }
.eye-field {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.border-eye-field {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.border-eye {
  position: absolute;
  height: auto;
  opacity: var(--rest-opacity);
  transform: translate(-50%, -50%) rotate(var(--angle));
}

.eye-color {
  clip-path: inset(0 var(--unfilled) 0 0);
  transition: clip-path v-bind('eyeColorTime + "ms"') ease;
}
.refilled .eye-color {
  clip-path: inset(0);
  transition-delay: var(--refill-delay);
}

.refill-eyes {
  position: fixed;
  inset-inline-end: max(0.85rem, env(safe-area-inset-right));
  inset-block-end: max(0.85rem, env(safe-area-inset-bottom));
  z-index: 3;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
}
.refill-eyes:hover:not(:disabled), .refill-eyes:focus-visible { border-color: var(--accent); }
.refill-eyes:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.refill-eyes:disabled { cursor: default; opacity: 0.65; }

/* A soft orange wave that leaves the main eye with the colour of a saved document. */
.feed-ripple {
  position: absolute;
  width: 240px;
  height: 240px;
  margin: -120px 0 0 -120px;
  border-radius: 50%;
  background: radial-gradient(closest-side, transparent 84%, rgb(253 78 31 / 0.4) 95%, transparent 100%);
  will-change: transform, opacity;
  animation: feed-ripple v-bind('rippleTime + "ms"') linear both;
}
@keyframes feed-ripple {
  from { transform: scale(0.1); opacity: 0.9; }
  to { transform: scale(var(--ripple-scale)); opacity: 0; }
}

.eye-field.swallowing { z-index: 2; }
.swallowing .border-eye {
  animation: pull-into-eye var(--pull-duration) var(--pull-delay) ease-in both;
}

@keyframes pull-into-eye {
  0% { opacity: var(--rest-opacity, 1); }
  66% {
    opacity: 1;
    transform: translate(calc(-50% + var(--curve-x)), calc(-50% + var(--curve-y)))
      rotate(calc(var(--angle) + var(--curve-spin))) scale(0.66);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--pull-x)), calc(-50% + var(--pull-y)))
      rotate(calc(var(--angle) + var(--pull-spin))) scale(0.06);
  }
}
.panem-content {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem 1.5rem;
  width: min(46rem, calc(100% - 2rem));
  margin-inline: auto;
  padding-block: 0.55rem;
  text-align: start;
  font-size: 0.8rem;
}
#panem-title { font-size: 1.125rem; line-height: 1.15; }
#panem-title strong { color: var(--warn); font-weight: inherit; }
.panem-hint { margin: 0; color: var(--muted); }
.progress-label, .progress-actions, .ticket-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.progress-label strong span, .progress-actions span { color: var(--muted); }
progress {
  display: block;
  width: 100%;
  height: 0.3rem;
  margin: 0.2rem 0 0;
  /* Styled by hand: browsers ignore or recolour accent-color on <progress>.
     The fill is the eyes' orange, so the bar matches the field it counts. */
  appearance: none;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  background: var(--line);
  color: var(--brand-orange);
}
progress::-webkit-progress-bar { background: var(--line); }
progress::-webkit-progress-value { background: var(--brand-orange); border-radius: 999px; }
progress::-moz-progress-bar { background: var(--brand-orange); border-radius: 999px; }
.progress-actions { margin-top: 0.35rem; gap: 0.3rem 0.6rem; }
.is-swallowing { background: transparent; border-color: transparent; visibility: hidden; }
.wolt-reveal {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.wolt-flying .wolt-disc { position: relative; z-index: 4; }
.wolt-flying p { visibility: hidden; }
.wolt-reveal p { margin: 0; color: var(--muted); }
.wolt-button { padding: 0; border: 0; border-radius: 50%; background: transparent; }
.wolt-disc img, .ticket-wolt { display: block; border-radius: 50%; }
.wolt-button:focus-visible { outline: 3px solid var(--accent); outline-offset: 5px; }
.ticket-actions { justify-content: flex-start; }
.voucher-download { display: grid; gap: 0.3rem; width: min(100%, 19rem); color: var(--accent); }
.voucher-download img { display: block; width: 100%; height: auto; }
.voucher-download:hover, .voucher-download:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (max-width: 34rem) {
  .panem-content { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: no-preference) {
  .border-eye { animation: border-eye-in 700ms ease-out both; }
  @keyframes border-eye-in {
    from { opacity: 0; }
  }
}
@media (prefers-reduced-motion: reduce) {
  .eye-color, .refilled .eye-color { transition: none; }
  .replay-intro, .feed-ripple { display: none; }
}
</style>
