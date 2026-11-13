import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LIBRARY_FILTERS,
  formatFileSize,
  libraryApiQuery,
  libraryRouteQuery,
  paginationItems,
  parseLibraryQuery
} from '../app/utils/libraryFilters.ts'

test('route query parses into filters and falls back on bad values', () => {
  assert.deepEqual(parseLibraryQuery({}), DEFAULT_LIBRARY_FILTERS)
  assert.deepEqual(
    parseLibraryQuery({ q: ' maja  župan ', author: 'Ana', uploader: 'ana@kaldi.si', from: '2024-01-01', to: '2024-02-01', sort: 'title', page: '3', size: '50' }),
    { q: 'maja župan', author: 'Ana', uploadedBy: 'ana@kaldi.si', from: '2024-01-01', to: '2024-02-01', sort: 'title', page: 3, pageSize: 50 }
  )
  const bad = parseLibraryQuery({ sort: 'random', page: '-2', size: '33', from: 'yesterday', to: '2024-13-01' })
  assert.equal(bad.sort, 'newest')
  assert.equal(bad.page, 1)
  assert.equal(bad.pageSize, 20)
  assert.equal(bad.from, '')
  assert.equal(bad.to, '')
  // Swapped dates are put in order instead of failing.
  const swapped = parseLibraryQuery({ from: '2024-05-01', to: '2024-01-01' })
  assert.equal(swapped.from, '2024-01-01')
  assert.equal(swapped.to, '2024-05-01')
  assert.equal(parseLibraryQuery({ q: ['first', 'second'] }).q, 'first')
})

test('route query drops defaults and round-trips', () => {
  assert.deepEqual(libraryRouteQuery(DEFAULT_LIBRARY_FILTERS), {})
  const filters = { ...DEFAULT_LIBRARY_FILTERS, q: 'report', uploadedBy: 'ana@kaldi.si', sort: 'oldest' as const, page: 2, pageSize: 10 }
  const query = libraryRouteQuery(filters)
  assert.deepEqual(query, { q: 'report', uploader: 'ana@kaldi.si', sort: 'oldest', size: '10', page: '2' })
  assert.deepEqual(parseLibraryQuery(query), filters)
})

test('API query always sends paging and sort', () => {
  assert.deepEqual(libraryApiQuery(DEFAULT_LIBRARY_FILTERS), { sort: 'newest', page: 1, pageSize: 20 })
  assert.deepEqual(
    libraryApiQuery({ ...DEFAULT_LIBRARY_FILTERS, author: 'Ana', uploadedBy: 'ana@kaldi.si', to: '2024-01-31' }),
    { sort: 'newest', page: 1, pageSize: 20, author: 'Ana', uploadedBy: 'ana@kaldi.si', to: '2024-01-31' }
  )
})

test('pagination shows the ends, neighbours, and gaps', () => {
  assert.deepEqual(paginationItems(1, 1), [1])
  assert.deepEqual(paginationItems(3, 7), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(paginationItems(1, 12), [1, 2, 3, 4, 5, null, 12])
  assert.deepEqual(paginationItems(6, 12), [1, null, 5, 6, 7, null, 12])
  assert.deepEqual(paginationItems(12, 12), [1, null, 8, 9, 10, 11, 12])
  assert.deepEqual(paginationItems(4, 12), [1, 2, 3, 4, 5, null, 12])
})

test('file sizes read naturally', () => {
  assert.equal(formatFileSize(null), '')
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(2048), '2.0 KB')
  assert.equal(formatFileSize(1536 * 1024), '1.5 MB')
  assert.equal(formatFileSize(250 * 1024 * 1024), '250 MB')
})
