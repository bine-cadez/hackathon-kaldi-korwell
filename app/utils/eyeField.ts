// Geometry and timing for the field of small eyes behind the upload form
// (EyeField.vue draws them, PanemRewards.vue drives them). Everything is
// derived from a deterministic hash, so the same eyes light up for the same
// saved progress on every visit.

// The most eyes the field ever draws; smaller screens draw fewer (see eyeCountFor).
export const EYE_COUNT = 2_000
// How long one eye takes to colour in, and how the colour sweeps across the field.
export const EYE_COLOR_TIME = 500
export const REFILL_TIME = 3600
export const UPLOAD_COLOR_TIME = 4000
// A saved document's colour ripples out from the main eye over this long.
export const RIPPLE_TIME = UPLOAD_COLOR_TIME - EYE_COLOR_TIME

// Keep the eyes about the same size on every screen, so a phone draws fewer of
// them. Any first part of the list is still spread evenly over the page, and
// its fill order still covers the whole range, so progress looks the same.
export function eyeCountFor (width: number, height: number): number {
  return Math.max(500, Math.min(EYE_COUNT, Math.round(width * height / 540)))
}

export function scatter (index: number, offset: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(offset, 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

// A stable shuffle: eye `index` is the fillRanks[index]-th to light up.
export const fillRanks = (() => {
  const ranks = Array.from({ length: EYE_COUNT }, (_, index) => index)
  for (let index = ranks.length - 1; index > 0; index--) {
    const other = Math.floor(scatter(index, 6) * (index + 1))
    const rank = ranks[index]!
    ranks[index] = ranks[other]!
    ranks[other] = rank
  }
  return ranks
})()

export interface EyeLayout {
  // Struct of arrays: one entry per eye, positions in CSS pixels.
  x: Float32Array
  y: Float32Array
  angle: Float32Array // radians
  size: Float32Array // scale on top of `width`
  delay: Float32Array // intro stagger, ms
  fillOrder: Uint16Array
  count: number
  width: number // base eye width in CSS pixels
}

// Spread the eyes evenly: for each eye, try a few random spots and keep the one
// with the most room around it (a cheap blue-noise layout).
export function layoutEyes (width: number, height: number, count = eyeCountFor(width, height)): EyeLayout {
  const spacing = Math.sqrt(width * height / count)
  const columns = Math.ceil(width / spacing)
  const rows = Math.ceil(height / spacing)
  const buckets = new Map<number, number[]>()
  const layout: EyeLayout = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    angle: new Float32Array(count),
    size: new Float32Array(count),
    delay: new Float32Array(count),
    fillOrder: new Uint16Array(count),
    count,
    width: spacing * 1.23
  }

  function clearance (x: number, y: number) {
    const col = Math.floor(x / spacing)
    const row = Math.floor(y / spacing)
    let nearest = spacing ** 2
    for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(columns - 1, col + 1); c++) {
        for (const other of buckets.get(r * columns + c) ?? []) {
          nearest = Math.min(nearest, (layout.x[other]! - x) ** 2 + (layout.y[other]! - y) ** 2)
        }
      }
    }
    return nearest
  }

  for (let index = 0; index < count; index++) {
    let bestX = 0
    let bestY = 0
    let best = -1
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = index * 12 + attempt
      const x = scatter(candidate, 1) * width
      const y = scatter(candidate, 2) * height
      const room = clearance(x, y)
      if (room > best) {
        best = room
        bestX = x
        bestY = y
      }
    }
    layout.x[index] = bestX
    layout.y[index] = bestY
    const key = Math.floor(bestY / spacing) * columns + Math.floor(bestX / spacing)
    const bucket = buckets.get(key) ?? []
    bucket.push(index)
    buckets.set(key, bucket)

    layout.angle[index] = (-24 + scatter(index, 3) * 48) * Math.PI / 180
    layout.size[index] = 0.72 + scatter(index, 4) * 0.44
    layout.delay[index] = Math.round(scatter(index, 5) * 380)
    layout.fillOrder[index] = fillRanks[index]!
  }
  return layout
}

// The path one eye takes when the big eye swallows the field: it curves
// towards the vortex, spins, shrinks, and fades. Few eyes leave early; most
// go in the last stretch, and those travel faster.
export interface PullPath {
  dx: number
  dy: number
  curveX: number
  curveY: number
  curveSpin: number // degrees
  pullSpin: number // degrees
  delay: number // ms
  duration: number // ms
}

export function pullPath (x: number, y: number, vortex: { x: number, y: number }, index: number, early = false): PullPath {
  const dx = vortex.x - x
  const dy = vortex.y - y
  const rank = scatter(index, 7) * (early ? 0.55 : 1)
  const reach = 0.4 + scatter(index, 8) * 0.32
  const bend = 0.12 + scatter(index, 9) * 0.38
  const spin = 230 + scatter(index, 10) * 270
  return {
    dx,
    dy,
    curveX: dx * reach - dy * bend,
    curveY: dy * reach + dx * bend,
    curveSpin: Math.round(spin * 0.4),
    pullSpin: Math.round(spin),
    delay: Math.round(650 + Math.pow(rank, 0.26) * 3550),
    duration: Math.round(2000 - Math.sqrt(rank) * 1000 - scatter(index, 11) * 450)
  }
}

// CSS-compatible cubic-bezier easing, so the canvas keeps the old curves.
export function cubicBezier (x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const error = sampleX(t) - x
      const slope = slopeX(t)
      if (Math.abs(error) < 1e-4 || Math.abs(slope) < 1e-6) break
      t -= error / slope
    }
    return ((ay * t + by) * t + cy) * t
  }
}
