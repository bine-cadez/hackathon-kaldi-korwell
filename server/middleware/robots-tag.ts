export default defineEventHandler((event) => {
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
})
