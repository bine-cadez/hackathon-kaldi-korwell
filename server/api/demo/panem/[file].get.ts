import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'

export default defineEventHandler((event) => {
  const file = getRouterParam(event, 'file') ?? ''
  const reference = /^(DEMO-[0-9A-F]{8})\.svg$/.exec(file)?.[1]
  if (!import.meta.dev || !reference) throw createError({ statusCode: 404 })

  setHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8')
  if (getQuery(event).preview !== '1') {
    setHeader(event, 'Content-Disposition', `attachment; filename="korwell-${file.toLowerCase()}"`)
  }
  setHeader(event, 'Cache-Control', 'no-store')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 460" width="900" height="460">
  <rect width="900" height="460" fill="#f2f0ed"/>
  <rect x="22" y="22" width="856" height="416" rx="24" fill="#fffaf1" stroke="#593d14" stroke-width="2" stroke-dasharray="8 6"/>
  <g fill="#382811" text-anchor="middle">
    <text x="450" y="93" font-family="sans-serif" font-size="19" letter-spacing="5">THE KALDI ARCHIVE</text>
    <text x="450" y="164" font-family="Georgia, serif" font-size="47">One Lunch on Kaldi’s eyes.</text>
    <text x="450" y="214" font-family="sans-serif" font-size="23">Sample HR claim · Wolt lunch</text>
    <path d="M80 248H820" fill="none" stroke="#b49c76" stroke-dasharray="6 6"/>
    <text x="450" y="306" font-family="monospace" font-size="25">${reference}</text>
    <text x="450" y="369" font-family="sans-serif" font-weight="bold" font-size="21" fill="#8a341f">DEMO ONLY · NO REDEMPTION VALUE</text>
  </g>
</svg>`
})
