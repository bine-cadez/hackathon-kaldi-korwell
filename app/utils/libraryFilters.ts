// Library filters live in the URL (/library?q=…&author=…&page=2), so a view can
// be shared, reloaded, and walked with the back button. These helpers turn the
// route query into valid filters and back, dropping defaults to keep URLs short.

export const LIBRARY_SORTS = ['newest', 'oldest', 'title'] as const
export type LibrarySort = typeof LIBRARY_SORTS[number]

export const LIBRARY_PAGE_SIZES = [10, 20, 50] as const
export const DEFAULT_LIBRARY_PAGE_SIZE = 20

// A type alias, not an interface, so it fits Pinia Colada's JSON query keys.
export type LibraryFilters = {
  q: string
  author: string
  uploadedBy: string
  from: string
  to: string
  sort: LibrarySort
  page: number
  pageSize: number
}

export const DEFAULT_LIBRARY_FILTERS: Readonly<LibraryFilters> = Object.freeze({
  q: '',
  author: '',
  uploadedBy: '',
  from: '',
  to: '',
  sort: 'newest',
  page: 1,
  pageSize: DEFAULT_LIBRARY_PAGE_SIZE
})

type RouteQueryValue = string | null | undefined | Array<string | null>
type RouteQuery = Record<string, RouteQueryValue>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PAGE = 10_000

function first (value: RouteQueryValue): string {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw : ''
}

function clean (value: RouteQueryValue): string {
  return first(value).normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 200)
}

function isoDate (value: RouteQueryValue): string {
  const raw = first(value).trim()
  return ISO_DATE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? raw : ''
}

// Never throws: a hand-edited URL falls back to defaults instead of an error page.
export function parseLibraryQuery (query: RouteQuery): LibraryFilters {
  const sort = first(query.sort) as LibrarySort
  const page = Number.parseInt(first(query.page), 10)
  const size = Number.parseInt(first(query.size), 10)
  let from = isoDate(query.from)
  let to = isoDate(query.to)
  if (from && to && from > to) [from, to] = [to, from]
  return {
    q: clean(query.q),
    author: clean(query.author),
    uploadedBy: clean(query.uploader),
    from,
    to,
    sort: LIBRARY_SORTS.includes(sort) ? sort : DEFAULT_LIBRARY_FILTERS.sort,
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
    pageSize: (LIBRARY_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_LIBRARY_PAGE_SIZE
  }
}

// Route query for these filters. Only non-default values appear in the URL.
export function libraryRouteQuery (filters: LibraryFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.q) query.q = filters.q
  if (filters.author) query.author = filters.author
  if (filters.uploadedBy) query.uploader = filters.uploadedBy
  if (filters.from) query.from = filters.from
  if (filters.to) query.to = filters.to
  if (filters.sort !== DEFAULT_LIBRARY_FILTERS.sort) query.sort = filters.sort
  if (filters.pageSize !== DEFAULT_LIBRARY_FILTERS.pageSize) query.size = String(filters.pageSize)
  if (filters.page > 1) query.page = String(filters.page)
  return query
}

// Parameters for GET /api/documents.
export function libraryApiQuery (filters: LibraryFilters): Record<string, string | number> {
  const query: Record<string, string | number> = {
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize
  }
  if (filters.q) query.q = filters.q
  if (filters.author) query.author = filters.author
  if (filters.uploadedBy) query.uploadedBy = filters.uploadedBy
  if (filters.from) query.from = filters.from
  if (filters.to) query.to = filters.to
  return query
}

export function hasActiveLibraryFilters (filters: LibraryFilters): boolean {
  return Boolean(filters.q || filters.author || filters.uploadedBy || filters.from || filters.to)
}

// Page numbers to show: always the first and last, the current page with one
// neighbour each side, and `null` for a gap. 1 … 4 5 6 … 12
export function paginationItems (page: number, totalPages: number): Array<number | null> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, totalPages, page - 1, page, page + 1])
  // Near either end, show a fuller run instead of a gap of one page.
  if (page <= 4) [2, 3, 4, 5].forEach(value => pages.add(value))
  if (page >= totalPages - 3) [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach(value => pages.add(value))
  const sorted = [...pages].filter(value => value >= 1 && value <= totalPages).sort((left, right) => left - right)
  const items: Array<number | null> = []
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && value - previous > 1) items.push(null)
    items.push(value)
  })
  return items
}

// "1.2 MB" for the Library and document view. Fixed English units so the
// server-rendered and hydrated text always match.
export function formatFileSize (bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
