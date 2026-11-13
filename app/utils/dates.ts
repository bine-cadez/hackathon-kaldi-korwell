// Dates in the Library are shown in Ljubljana time, the same on the server and
// in the browser, so server-rendered text matches after hydration.
const TIME_ZONE = 'Europe/Ljubljana'

function parse (iso: string | null | undefined) {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "12 Sep 2026" */
export function formatShortDate (iso: string | null | undefined): string {
  const date = parse(iso)
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE }) : (iso ?? '')
}

/** "12 Sep 2026, 14:05" */
export function formatDateTime (iso: string | null | undefined): string {
  const date = parse(iso)
  return date
    ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE })
    : (iso ?? '')
}
