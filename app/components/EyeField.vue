<script setup lang="ts">
import {
  cubicBezier,
  EYE_COLOR_TIME,
  EYE_COUNT,
  layoutEyes,
  pullPath,
  REFILL_TIME,
  RIPPLE_TIME,
  type EyeLayout,
  type PullPath
} from '~/utils/eyeField'

// The field of small eyes behind the upload form, drawn on one canvas.
//
// Each part of an eye (frame, iris, coloured iris, pupil) is drawn once into a
// small offscreen sprite; a frame is then a few drawImage calls per eye. The
// loop runs only while something moves (intro, colouring, the swallow, pupils
// following the mouse, a blink) and sleeps otherwise, so an idle page costs
// nothing.
const props = defineProps<{
  intro: 'waiting' | 'scattering' | 'done'
  // Where the intro scatters from, in % of the field (the big eye).
  origin: { x: number, y: number }
  // Eyes whose fill order is below this are coloured; the fractional part colours one eye partly.
  filled: number
  // Colour every eye (the refill preview), sweeping from `filled` up.
  refill: boolean
  // While set, newly coloured eyes light up by their distance from `origin`,
  // reaching this many pixels (the farthest corner) after RIPPLE_TIME.
  ripple: number | null
  hidden: boolean
  // While set, every eye is pulled into this point (field pixels).
  vortex: { x: number, y: number } | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)

// Eye geometry, in the 240×120 viewBox units of ArchiveEye. The centre (120, 60) is the origin when drawing.
const PATHS = {
  frame: 'M120 4 233 60 120 116 7 60Z',
  iris: 'M37 59c22-28 51-39 83-39 34 0 63 14 83 39-21 26-50 42-83 42-34 0-63-16-83-42Z',
  ticks: 'M18 60h9m186 0h9',
  glint: 'M130 45h13'
}
const PUPIL = { x: 125, y: 56, radius: 28, box: 33 }
// Sprites cover the eye with a little room for the strokes.
const BOX = { x: -4, y: -4, width: 248, height: 128 }
// Largest on-screen scale: the biggest eye, grown under the cursor.
const MAX_SCALE = 1.16 * 1.4

const TIMING = {
  scatter: 1550,
  scatterFade: 260,
  blink: 240,
  gaze: 90,
  hover: 140
}
const HOVER_RADIUS = 160
const ease = cubicBezier(0.25, 0.1, 0.25, 1)
const easeIn = cubicBezier(0.42, 0, 1, 1)
const easeOut = cubicBezier(0, 0, 0.58, 1)
const scatterEase = cubicBezier(0.19, 0.75, 0.28, 1)

let context: CanvasRenderingContext2D | null = null
let layout: EyeLayout | null = null
let size = { width: 0, height: 0, ratio: 1 }
let builtFor = ''
let sprites: Record<'body' | 'frame' | 'iris' | 'irisColor' | 'pupil' | 'pupilColor', HTMLCanvasElement> | null = null

// Per-eye animation state, indexed like the layout.
const fillFrom = new Float32Array(EYE_COUNT)
const fillTo = new Float32Array(EYE_COUNT)
const fillStart = new Float64Array(EYE_COUNT).fill(-1)
const gazeX = new Float32Array(EYE_COUNT)
const gazeY = new Float32Array(EYE_COUNT)
const hover = new Float32Array(EYE_COUNT)
const blinkStart = new Float64Array(EYE_COUNT).fill(-1)
let pulls: PullPath[] = []

let introStart = -1
let swallowStart = -1
let pointer: { x: number, y: number } | null = null
let reducedMotion = false
let frame = 0
let lastTime = 0
let blinkTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined
let motionQuery: MediaQueryList | undefined

function requestDraw () {
  if (!frame && context) frame = requestAnimationFrame(draw)
}

// ---- Fill ------------------------------------------------------------------

function currentFill (index: number, now: number) {
  const start = fillStart[index]!
  if (start < 0) return fillTo[index]!
  const progress = (now - start) / EYE_COLOR_TIME
  if (progress <= 0) return fillFrom[index]!
  if (progress >= 1) {
    fillStart[index] = -1
    return fillTo[index]!
  }
  return fillFrom[index]! + (fillTo[index]! - fillFrom[index]!) * ease(progress)
}

function fillDelay (index: number, order: number) {
  if (props.refill) {
    const remaining = Math.max(1, EYE_COUNT - props.filled)
    return Math.max(0, (order - props.filled) / remaining) * REFILL_TIME
  }
  if (props.ripple && layout) {
    const distance = Math.hypot(
      layout.x[index]! - props.origin.x / 100 * size.width,
      layout.y[index]! - props.origin.y / 100 * size.height
    )
    return Math.min(1, distance / props.ripple) * RIPPLE_TIME
  }
  return 0
}

function syncFills (animate: boolean) {
  if (!layout) return
  const now = performance.now()
  for (let index = 0; index < layout.count; index++) {
    const order = layout.fillOrder[index]!
    const target = props.refill ? 1 : Math.max(0, Math.min(1, props.filled - order))
    if (target === fillTo[index]) continue
    fillFrom[index] = currentFill(index, now)
    fillTo[index] = target
    fillStart[index] = animate ? now + fillDelay(index, order) : -1
  }
  requestDraw()
}

// ---- Sprites ---------------------------------------------------------------

function makeSprite (scale: number, box: { x: number, y: number, width: number, height: number }, paint: (ctx: CanvasRenderingContext2D) => void) {
  const sprite = document.createElement('canvas')
  sprite.width = Math.ceil(box.width * scale)
  sprite.height = Math.ceil(box.height * scale)
  const ctx = sprite.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale)
  ctx.lineJoin = 'round'
  paint(ctx)
  return sprite
}

function buildSprites () {
  if (!layout || !canvas.value) return
  const style = getComputedStyle(canvas.value)
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const line = color('--muted', '#695944')
  const orange = color('--brand-orange', '#fd4e1f')
  const ink = color('--ink', '#382811')
  const paper = color('--paper', '#f2f0ed')
  const frame = new Path2D(PATHS.frame)
  const iris = new Path2D(PATHS.iris)
  const ticks = new Path2D(PATHS.ticks)
  const glint = new Path2D(PATHS.glint)
  const pupilBox = { x: PUPIL.x - PUPIL.box, y: PUPIL.y - PUPIL.box, width: PUPIL.box * 2, height: PUPIL.box * 2 }
  const scale = layout.width / 240 * size.ratio * MAX_SCALE

  const stroke = (ctx: CanvasRenderingContext2D, path: Path2D, width = 4) => {
    ctx.strokeStyle = line
    ctx.lineWidth = width
    ctx.stroke(path)
  }
  const paintFrame = (ctx: CanvasRenderingContext2D) => {
    stroke(ctx, frame)
    stroke(ctx, ticks)
  }
  const paintPupil = (ctx: CanvasRenderingContext2D, coloured: boolean) => {
    ctx.beginPath()
    ctx.arc(PUPIL.x, PUPIL.y, PUPIL.radius, 0, Math.PI * 2)
    if (coloured) {
      ctx.fillStyle = ink
      ctx.fill()
    }
    ctx.strokeStyle = line
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(PUPIL.x, PUPIL.y, 21, 0, Math.PI * 2)
    ctx.lineWidth = 3
    ctx.stroke()
    if (coloured) {
      ctx.fillStyle = paper
      ctx.fillRect(130, 42, 13, 5)
    }
    stroke(ctx, glint)
  }

  sprites = {
    // Frame and empty iris together: the common case is one draw call.
    body: makeSprite(scale, BOX, (ctx) => {
      paintFrame(ctx)
      stroke(ctx, iris)
    }),
    frame: makeSprite(scale, BOX, paintFrame),
    iris: makeSprite(scale, BOX, ctx => stroke(ctx, iris)),
    irisColor: makeSprite(scale, BOX, (ctx) => {
      ctx.fillStyle = orange
      ctx.fill(iris)
      stroke(ctx, iris)
    }),
    pupil: makeSprite(scale, pupilBox, ctx => paintPupil(ctx, false)),
    pupilColor: makeSprite(scale, pupilBox, ctx => paintPupil(ctx, true))
  }
}

// ---- Layout ----------------------------------------------------------------

function resize () {
  const element = canvas.value
  if (!element) return
  const width = element.clientWidth
  const height = element.clientHeight
  if (!width || !height) return
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  if (width === size.width && height === size.height && ratio === size.ratio && layout) return
  size = { width, height, ratio }
  element.width = Math.round(width * ratio)
  element.height = Math.round(height * ratio)
  layout = layoutEyes(width, height)
  // Sprites are rasterised for one eye size and pixel ratio.
  const spriteKey = `${layout.width.toFixed(1)}@${ratio}`
  if (spriteKey !== builtFor) {
    buildSprites()
    builtFor = spriteKey
  }
  if (props.vortex) startSwallow()
  syncFills(false)
  requestDraw()
}

function startSwallow () {
  if (!layout || !props.vortex) return
  pulls = Array.from({ length: layout.count }, (_, index) => pullPath(layout!.x[index]!, layout!.y[index]!, props.vortex!, index))
}

// ---- Drawing ---------------------------------------------------------------

function draw (time: number) {
  frame = 0
  const ctx = context
  if (!ctx || !layout || !sprites) return
  const dt = Math.min(50, lastTime ? time - lastTime : 16)
  lastTime = time
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (props.hidden || props.intro === 'waiting') {
    lastTime = 0
    return
  }

  const { ratio } = size
  const unit = layout.width / 240
  const bounds = ctx.canvas.getBoundingClientRect()
  const swallowing = swallowStart >= 0
  const follow = pointer && !reducedMotion && !swallowing
  const pointerX = follow ? pointer!.x - bounds.left : 0
  const pointerY = follow ? pointer!.y - bounds.top : 0
  const gazeStep = 1 - Math.exp(-dt / TIMING.gaze)
  const hoverStep = 1 - Math.exp(-dt / TIMING.hover)
  const originX = props.origin.x / 100 * size.width
  const originY = props.origin.y / 100 * size.height
  const s = sprites
  let active = false
  let scattering = false
  let alpha = 1
  ctx.globalAlpha = 1

  for (let index = 0; index < layout.count; index++) {
    let x = layout.x[index]!
    let y = layout.y[index]!
    let angle = layout.angle[index]!
    let scale = layout.size[index]!
    let opacity = 1

    if (introStart >= 0) {
      const elapsed = time - introStart - layout.delay[index]!
      if (elapsed < 0) {
        scattering = true
        continue
      }
      const progress = Math.min(1, elapsed / TIMING.scatter)
      if (progress < 1) scattering = true
      const travel = scatterEase(progress)
      const grow = easeOut(progress)
      x = originX + (x - originX) * travel
      y = originY + (y - originY) * travel
      scale = 0.1 + (scale - 0.1) * grow
      angle *= grow
      opacity = Math.min(1, elapsed / TIMING.scatterFade)
    }

    if (swallowing) {
      const pull = pulls[index]!
      const progress = (time - swallowStart - pull.delay) / pull.duration
      if (progress >= 1) continue
      active = true
      if (progress > 0) {
        const degrees = Math.PI / 180
        if (progress < 0.66) {
          const step = easeIn(progress / 0.66)
          x += pull.curveX * step
          y += pull.curveY * step
          angle += pull.curveSpin * degrees * step
          scale += (0.66 - scale) * step
        } else {
          const step = easeIn((progress - 0.66) / 0.34)
          x += pull.curveX + (pull.dx - pull.curveX) * step
          y += pull.curveY + (pull.dy - pull.curveY) * step
          angle += (pull.curveSpin + (pull.pullSpin - pull.curveSpin) * step) * degrees
          scale = 0.66 + (0.06 - 0.66) * step
          opacity = 1 - step
        }
      }
    }

    // Pupils look at the cursor; eyes close to it grow a little.
    let targetGazeX = 0
    let targetGazeY = 0
    let targetHover = 0
    if (follow) {
      const dx = pointerX - x
      const dy = pointerY - y
      const distance = Math.hypot(dx, dy)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const reach = Math.max(70, distance)
      targetGazeX = 17 * (dx * cos + dy * sin) / reach
      targetGazeY = 8 * (dy * cos - dx * sin) / reach
      const near = Math.max(0, 1 - distance / HOVER_RADIUS)
      targetHover = near * near * (3 - 2 * near)
    }
    const gx = gazeX[index]! + (targetGazeX - gazeX[index]!) * gazeStep
    const gy = gazeY[index]! + (targetGazeY - gazeY[index]!) * gazeStep
    const hv = hover[index]! + (targetHover - hover[index]!) * hoverStep
    if (Math.abs(targetGazeX - gx) > 0.05 || Math.abs(targetGazeY - gy) > 0.05 || Math.abs(targetHover - hv) > 0.002) active = true
    gazeX[index] = gx
    gazeY[index] = gy
    hover[index] = hv
    scale *= 1 + 0.35 * hv

    let lid = 1
    const blink = blinkStart[index]!
    if (blink >= 0) {
      const progress = (time - blink) / TIMING.blink
      if (progress >= 1) {
        blinkStart[index] = -1
      } else {
        active = true
        lid = 1 - 0.92 * Math.sin(Math.PI * Math.max(0, progress))
      }
    }

    const fill = currentFill(index, time)
    if (fillStart[index]! >= 0) active = true

    if (opacity !== alpha) {
      alpha = opacity
      ctx.globalAlpha = opacity
    }
    const k = scale * unit * ratio
    const cos = Math.cos(angle) * k
    const sin = Math.sin(angle) * k
    const px = x * ratio
    const py = y * ratio

    // The frame never blinks; the iris and pupil squash towards the middle line.
    if (lid < 1) {
      ctx.setTransform(cos, sin, -sin, cos, px, py)
      ctx.drawImage(s.frame, BOX.x - 120, BOX.y - 60, BOX.width, BOX.height)
      ctx.setTransform(cos, sin, -sin * lid, cos * lid, px, py)
      ctx.drawImage(s.iris, BOX.x - 120, BOX.y - 60, BOX.width, BOX.height)
    } else {
      ctx.setTransform(cos, sin, -sin, cos, px, py)
      ctx.drawImage(s.body, BOX.x - 120, BOX.y - 60, BOX.width, BOX.height)
    }
    // Colour sweeps in from the left, like the old clip-path.
    if (fill > 0) {
      const visible = Math.min(BOX.width, fill * 240 - BOX.x)
      const source = s.irisColor
      ctx.drawImage(source, 0, 0, source.width * visible / BOX.width, source.height, BOX.x - 120, BOX.y - 60, visible, BOX.height)
    }
    const pupil = fill * 240 >= PUPIL.x + gx ? s.pupilColor : s.pupil
    ctx.drawImage(pupil, PUPIL.x - PUPIL.box - 120 + gx, PUPIL.y - PUPIL.box - 60 + gy, PUPIL.box * 2, PUPIL.box * 2)
  }

  if (introStart >= 0 && !scattering) introStart = -1
  if (active || scattering) requestDraw()
  else lastTime = 0
}

// ---- Idle blinking -----------------------------------------------------------

function scheduleBlink () {
  clearTimeout(blinkTimer)
  if (reducedMotion) return
  blinkTimer = setTimeout(() => {
    if (!document.hidden && !props.hidden && props.intro === 'done' && swallowStart < 0) {
      const now = performance.now()
      const count = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < count; i++) blinkStart[Math.floor(Math.random() * (layout?.count ?? 0))] = now
      requestDraw()
    }
    scheduleBlink()
  }, 900 + Math.random() * 1600)
}

// ---- Wiring ----------------------------------------------------------------

function followPointer (event: PointerEvent) {
  if (event.pointerType !== 'mouse' || reducedMotion) return
  pointer = { x: event.clientX, y: event.clientY }
  requestDraw()
}

function releasePointer () {
  pointer = null
  requestDraw()
}

function updateMotion () {
  reducedMotion = Boolean(motionQuery?.matches)
  if (reducedMotion) pointer = null
  scheduleBlink()
  requestDraw()
}

watch(() => [props.filled, props.refill, props.ripple] as const, () => syncFills(!reducedMotion))

watch(() => props.intro, (intro) => {
  introStart = intro === 'scattering' && !reducedMotion ? performance.now() : -1
  requestDraw()
})

watch(() => props.vortex, (vortex) => {
  swallowStart = vortex ? performance.now() : -1
  if (vortex) startSwallow()
  requestDraw()
})

watch(() => props.hidden, requestDraw)

onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionQuery.matches
  motionQuery.addEventListener('change', updateMotion)
  if (props.intro === 'scattering' && !reducedMotion) introStart = performance.now()
  resize()
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  window.addEventListener('pointermove', followPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', releasePointer)
  window.addEventListener('blur', releasePointer)
  scheduleBlink()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  frame = 0
  clearTimeout(blinkTimer)
  observer?.disconnect()
  motionQuery?.removeEventListener('change', updateMotion)
  window.removeEventListener('pointermove', followPointer)
  document.documentElement.removeEventListener('pointerleave', releasePointer)
  window.removeEventListener('blur', releasePointer)
})
</script>

<template>
  <canvas ref="canvas" class="eye-canvas" aria-hidden="true" />
</template>

<style scoped>
.eye-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
