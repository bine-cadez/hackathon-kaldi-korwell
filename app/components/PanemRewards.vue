<script setup lang="ts">
const props = defineProps<{ anchor: HTMLElement | null, form: HTMLFormElement | null, demo: boolean, replay: boolean }>()
const emit = defineEmits<{
  eyeTravel: [travel: { x: number, y: number, scale: number, returning: boolean, duration: number } | null]
  eyeBlackHole: [open: boolean]
}>()
const eyeCount = 2_000
const demoGoal = 24_000
const wordsPerEye = demoGoal / eyeCount
const roundLength = 5
const pullTime = 5400
const travelTime = 1750
const returnTime = 1100
const woltFlightTime = 4000
const fillTime = 550
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
  { side: 'top', position: 0.19, angle: -19 },
  { side: 'top', position: 0.77, angle: 14 },
  { side: 'left', position: 0.22, angle: 16 },
  { side: 'right', position: 0.36, angle: -12 },
  { side: 'left', position: 0.76, angle: -16 },
  { side: 'right', position: 0.84, angle: 18 },
  { side: 'bottom', position: 0.65, angle: -13 }
] as const

function borderEyePosition (eye: typeof borderEyes[number]) {
  const { x, y, width, height } = formBox.value
  switch (eye.side) {
    case 'top': return { x: x + width * eye.position, y: y - 2 }
    case 'bottom': return { x: x + width * eye.position, y: y + height + 2 }
    case 'left': return { x: x - 9, y: y + height * eye.position }
    case 'right': return { x: x + width + 9, y: y + height * eye.position }
  }
}

const words = ref(0)
const clicks = ref(0)
const lastAdded = ref(0)
const phase = ref<'collecting' | 'full' | 'swallowing' | 'wolt' | 'voucher'>('collecting')
const voucherReference = ref('')
const voucherUrl = computed(() => '/api/demo/panem/' + voucherReference.value + '.svg')
const fillButton = ref<HTMLButtonElement | null>(null)
const woltButton = ref<HTMLButtonElement | null>(null)
const voucherTicket = ref<HTMLAnchorElement | null>(null)
let observer: ResizeObserver | undefined
let introTimer: ReturnType<typeof setTimeout> | undefined
let revealTimer: ReturnType<typeof setTimeout> | undefined
let woltFlight: Animation | undefined
let followFrame = 0

function scatter (index: number, offset: number) {
  // Integer hashing gives the server and browser the same layout.
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(offset, 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

// Keep the shuffle stable so saved progress colors the same eyes on reload.
const fillRanks = Array.from({ length: eyeCount }, (_, index) => index)
for (let index = fillRanks.length - 1; index > 0; index--) {
  const other = Math.floor(scatter(index, 6) * (index + 1))
  const rank = fillRanks[index]!
  fillRanks[index] = fillRanks[other]!
  fillRanks[other] = rank
}

const layout = computed(() => {
  const { width, height } = fieldSize.value
  const spacing = Math.sqrt(width * height / eyeCount)
  const columns = Math.ceil(width / spacing)
  const rows = Math.ceil(height / spacing)
  const buckets = new Map<number, { x: number, y: number }[]>()

  function clearance (x: number, y: number) {
    const col = Math.floor(x / spacing)
    const row = Math.floor(y / spacing)
    let nearest = spacing ** 2
    for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(columns - 1, col + 1); c++) {
        for (const point of buckets.get(r * columns + c) ?? []) {
          nearest = Math.min(nearest, (point.x - x) ** 2 + (point.y - y) ** 2)
        }
      }
    }
    return nearest
  }

  // Try several random positions and keep the one with the most room around it.
  const eyes = Array.from({ length: eyeCount }, (_, index) => {
    let best = { x: 0, y: 0, clearance: -1 }
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = index * 12 + attempt
      const x = scatter(candidate, 1) * width
      const y = scatter(candidate, 2) * height
      const distance = clearance(x, y)
      if (distance > best.clearance) best = { x, y, clearance: distance }
    }
    const key = Math.floor(best.y / spacing) * columns + Math.floor(best.x / spacing)
    const bucket = buckets.get(key) ?? []
    bucket.push(best)
    buckets.set(key, bucket)

    return {
      x: best.x * 100 / width,
      y: best.y * 100 / height,
      angle: -24 + scatter(index, 3) * 48,
      size: 0.72 + scatter(index, 4) * 0.44,
      delay: Math.round(scatter(index, 5) * 380),
      fillOrder: fillRanks[index]!
    }
  })
  return { eyes, size: spacing * 1.23 }
})

function measureField () {
  const bounds = field.value?.getBoundingClientRect()
  const eye = props.anchor?.querySelector('.archive-eye')?.getBoundingClientRect()
  if (!bounds?.width || !bounds.height) return
  const form = props.form?.getBoundingClientRect()
  if (form) {
    formBox.value = { x: form.left - bounds.left, y: form.top - bounds.top, width: form.width, height: form.height }
  }
  fieldSize.value = { width: bounds.width, height: bounds.height }
  if (eye) {
    source.value = {
      x: (eye.left + eye.width / 2 - bounds.left) * 100 / bounds.width,
      y: (eye.top + eye.height / 2 - bounds.top) * 100 / bounds.height
    }
  }
}

function pullStyle (x: number, y: number, index: number) {
  const dx = vortex.value.x - x
  const dy = vortex.value.y - y
  const rank = scatter(index, 7) * (index < eyeCount ? 1 : 0.55)
  // Few eyes start early. Most start in the last stretch, and travel faster.
  const start = 650 + Math.pow(rank, 0.26) * 3550
  const duration = 2000 - Math.sqrt(rank) * 1000 - scatter(index, 11) * 450
  const reach = 0.4 + scatter(index, 8) * 0.32
  const bend = 0.12 + scatter(index, 9) * 0.38
  const spin = 230 + scatter(index, 10) * 270
  return {
    '--pull-x': dx + 'px',
    '--pull-y': dy + 'px',
    '--curve-x': (dx * reach - dy * bend) + 'px',
    '--curve-y': (dy * reach + dx * bend) + 'px',
    '--curve-spin': Math.round(spin * 0.4) + 'deg',
    '--pull-spin': Math.round(spin) + 'deg',
    '--pull-delay': Math.round(start) + 'ms',
    '--pull-duration': Math.round(duration) + 'ms'
  }
}

function borderEyeStyle (eye: typeof borderEyes[number], index: number) {
  const { x, y } = borderEyePosition(eye)
  return {
    left: x + 'px',
    top: y + 'px',
    '--angle': eye.angle + 'deg',
    ...(phase.value === 'swallowing' ? pullStyle(x, y, eyeCount + index) : {})
  }
}

function eyeFill (fillOrder: number) {
  return Math.max(0, Math.min(100, (words.value / wordsPerEye - fillOrder) * 100))
}

onMounted(() => {
  measureField()
  if (field.value) {
    observer = new ResizeObserver(measureField)
    observer.observe(field.value)
    if (props.form) observer.observe(props.form)
  }

  if (!props.demo) {
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

  // The shared ArchiveEye transition takes 1.8s. Pause briefly after it lands.
  playIntro(2100)
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

function creditDocument (wordCount: number) {
  if (props.demo || wordCount <= 0) return
  lastAdded.value = wordCount
  words.value += wordCount
  saveProgress()
  if (words.value >= demoGoal && phase.value === 'collecting') revealReward()
}

defineExpose({ creditDocument })

function revealReward () {
  phase.value = 'full'
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    void showWolt()
    return
  }

  props.anchor?.scrollIntoView({ block: 'start', behavior: 'instant' })
  revealTimer = setTimeout(moveEyeToCenter, fillTime)
}

function moveEyeToCenter () {
  if (intro.value !== 'done') finishIntro()
  clearTimeout(introTimer)
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

  const button = woltButton.value
  const bounds = field.value?.getBoundingClientRect()
  if (button && bounds && typeof button.animate === 'function') {
    const slot = button.getBoundingClientRect()
    const slotX = slot.left + slot.width / 2
    const slotY = slot.top + slot.height / 2
    const startX = bounds.left + vortex.value.x - slotX
    const startY = bounds.top + vortex.value.y - slotY
    const floor = bounds.bottom - slot.bottom
    const bounceX = startX * 0.58
    const arc = Math.min(110, Math.max(46, (floor - startY) * 0.32))

    woltFlight = button.animate([
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
      if (!button || !woltFlying.value) return
      const overflow = button.getBoundingClientRect().bottom - window.innerHeight
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
  await nextTick()
  button?.focus({ preventScroll: true })
}

async function showWolt () {
  phase.value = 'wolt'
  await nextTick()
  woltButton.value?.focus()
}

async function openVoucher () {
  voucherReference.value = `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  phase.value = 'voucher'
  saveProgress()
  await nextTick()
  voucherTicket.value?.focus()
}

async function startNextRound () {
  words.value = props.demo ? 0 : Math.max(0, words.value - demoGoal)
  clicks.value = 0
  lastAdded.value = 0
  voucherReference.value = ''
  phase.value = words.value >= demoGoal ? 'wolt' : 'collecting'
  saveProgress()
  await nextTick()
  fillButton.value?.focus()
}

onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(introTimer)
  clearTimeout(revealTimer)
  cancelAnimationFrame(followFrame)
  woltFlight?.cancel()
  emit('eyeTravel', null)
  emit('eyeBlackHole', false)
})
</script>

<template>
  <section class="panem" aria-labelledby="panem-title">
    <svg class="eye-symbols" width="0" height="0" aria-hidden="true">
      <defs>
        <path id="panem-iris" d="M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z"/>
        <circle id="panem-pupil" cx="125" cy="56" r="28"/>
        <g id="panem-eye-lines" fill="none" stroke="#675e53" stroke-width="4">
          <path d="M120 4 233 60 120 116 7 60Z"/>
          <use href="#panem-iris"/>
          <use href="#panem-pupil"/>
          <circle cx="125" cy="56" r="21" stroke-width="3"/>
          <path d="M18 60h9m186 0h9M130 45h13"/>
        </g>
      </defs>
    </svg>

    <div
      ref="field"
      class="eye-field"
      :class="[intro, { swallowing: phase === 'swallowing' }]"
      :style="{
        '--origin-x': source.x + '%',
        '--origin-y': source.y + '%',
        '--eye-width': layout.size + 'px'
      }"
      aria-hidden="true"
    >
      <svg
        v-for="(eye, index) in layout.eyes"
        v-show="phase === 'collecting' || phase === 'full' || phase === 'swallowing'"
        :key="index"
        class="small-eye"
        viewBox="0 0 240 120"
        :style="{
          '--x': eye.x + '%',
          '--y': eye.y + '%',
          '--angle': eye.angle + 'deg',
          '--size': eye.size,
          '--delay': eye.delay + 'ms',
          '--unfilled': 100 - eyeFill(eye.fillOrder) + '%',
          ...(phase === 'swallowing'
            ? pullStyle(eye.x * fieldSize.width / 100, eye.y * fieldSize.height / 100, index)
            : {})
        }"
      >
        <use href="#panem-eye-lines" />
        <g class="eye-color">
          <use href="#panem-iris" fill="#fd4e1f" />
          <use href="#panem-pupil" fill="#382811" />
          <use href="#panem-eye-lines" />
          <path fill="#f2f0ed" d="M130 42h13v5h-13z"/>
        </g>
      </svg>
    </div>

    <div
      v-if="intro === 'done' && (phase === 'collecting' || phase === 'full' || phase === 'swallowing') && formBox.width"
      class="border-eye-field"
      :class="{ swallowing: phase === 'swallowing' }"
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
      </svg>
    </div>

    <div class="panem-banner" :class="{ 'is-swallowing': phase === 'swallowing' }">
      <div class="panem-content">
        <h2 id="panem-title"><strong>Panem</strong> et circenses.</h2>

        <div v-if="phase === 'collecting' || phase === 'full' || phase === 'swallowing'" class="progress-card">
          <div class="progress-label">
            <span>Words toward lunch</span>
            <strong>{{ format.format(Math.min(words, demoGoal)) }} <span>/ {{ format.format(demoGoal) }}</span></strong>
          </div>
          <progress :value="words" :max="demoGoal" aria-label="Words toward lunch" />
          <div v-if="demo" class="progress-actions">
            <button ref="fillButton" type="button" class="primary" :disabled="phase !== 'collecting' || intro !== 'done'" @click="fillEyes">
              Fill the eyes
            </button>
            <span>{{ clicks }} of {{ roundLength }} demo clicks</span>
            <button type="button" class="ghost replay-intro" :disabled="phase !== 'collecting' || intro !== 'done'" @click="replayIntro">
              Replay intro
            </button>
          </div>
          <p class="sr-only" role="status">
            {{ lastAdded ? '+' + format.format(lastAdded) + (demo ? ' demo words' : ' words from your document') : '' }}
          </p>
        </div>

        <div v-else-if="phase === 'wolt'" class="wolt-reveal" :class="{ 'wolt-flying': woltFlying }">
          <button ref="woltButton" class="wolt-button" type="button" :disabled="woltFlying" aria-label="Reveal your Wolt lunch voucher" @click="openVoucher">
            <img src="/panem/wolt-disc.jpg" width="60" height="60" alt="">
          </button>
          <p>Click Wolt to reveal your lunch.</p>
        </div>

        <div v-else class="ticket-actions">
          <a ref="voucherTicket" class="voucher-download" :href="voucherUrl" download title="Download sample voucher">
            <img
              :src="voucherUrl + '?preview=1'"
              width="900"
              height="460"
              alt="Download sample voucher: One Lunch on Kaldi’s eyes."
            >
          </a>
          <button type="button" class="ghost" @click="startNextRound">Start another round</button>
        </div>

      </div>
    </div>

    <span v-if="phase === 'swallowing'" class="sr-only" role="status">All eyes filled. Revealing your lunch reward.</span>
  </section>
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
  width: 28px;
  height: auto;
  opacity: 0.62;
  transform: translate(-50%, -50%) rotate(var(--angle));
}

.small-eye {
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: var(--eye-width);
  height: auto;
  aspect-ratio: 2;
  transform: translate(-50%, -50%) rotate(var(--angle)) scale(var(--size));
}
.eye-color {
  clip-path: inset(0 var(--unfilled) 0 0);
  transition: clip-path 500ms ease;
}

.waiting .small-eye {
  left: var(--origin-x);
  top: var(--origin-y);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.1);
}
.scattering .small-eye {
  transition: left 1550ms var(--delay) cubic-bezier(0.19, 0.75, 0.28, 1),
    top 1550ms var(--delay) cubic-bezier(0.19, 0.75, 0.28, 1),
    transform 1550ms var(--delay) ease-out, opacity 260ms var(--delay) ease-out;
}

.eye-field.swallowing { z-index: 2; }
.swallowing :is(.small-eye, .border-eye) {
  animation: pull-into-eye var(--pull-duration) var(--pull-delay) ease-in both;
}

@keyframes pull-into-eye {
  0% { opacity: 1; }
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
#panem-title strong { color: #a83920; font-weight: inherit; }
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
  accent-color: #ac3e22;
}
.progress-actions { margin-top: 0.35rem; gap: 0.3rem 0.6rem; }
.progress-actions button { padding: 0.25rem 0.65rem; }
.is-swallowing { background: transparent; border-color: transparent; visibility: hidden; }
.wolt-reveal {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.wolt-flying .wolt-button { position: relative; z-index: 4; opacity: 1; }
.wolt-flying p { visibility: hidden; }
.wolt-reveal p { margin: 0; color: var(--muted); }
.wolt-button { padding: 0; border: 0; border-radius: 50%; background: transparent; }
.wolt-button img { display: block; border-radius: inherit; }
.wolt-button:focus-visible { outline: 3px solid var(--accent); outline-offset: 5px; }
.ticket-actions { justify-content: flex-start; }
.voucher-download { display: block; width: min(100%, 19rem); }
.voucher-download img { display: block; width: 100%; height: auto; }
.voucher-download:hover, .voucher-download:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (max-width: 34rem) {
  .panem-content { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .eye-color, .scattering .small-eye { transition: none; }
  .replay-intro { display: none; }
}
</style>
