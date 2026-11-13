import assert from 'node:assert/strict'
import test from 'node:test'
import { describeError, errorMessage, errorStatus } from '../app/utils/errorMessage.ts'

function fetchError (statusCode: number | undefined, message: string, data?: unknown) {
  return Object.assign(new Error(message), { name: 'FetchError', statusCode, data })
}

test('errorStatus reads ofetch, Response-like and plain shapes', () => {
  assert.equal(errorStatus(fetchError(503, 'x')), 503)
  assert.equal(errorStatus({ status: 404 }), 404)
  assert.equal(errorStatus({ response: { status: 429 } }), 429)
  assert.equal(errorStatus(new Error('boom')), undefined)
  assert.equal(errorStatus(null), undefined)
})

test('errorMessage prefers the server message over the fetch wrapper text', () => {
  const error = fetchError(503, '[GET] "/api/documents": 503 D1 is unavailable', { message: 'D1 is unavailable' })
  assert.equal(errorMessage(error), 'D1 is unavailable')
  assert.equal(errorMessage('nope'), 'Request failed')
})

test('a request that never got a response is a retryable network error', () => {
  const described = describeError(fetchError(undefined, '[POST] "/api/search": <no response> Failed to fetch'))
  assert.equal(described.title, 'Can’t reach the archive')
  assert.equal(described.canRetry, true)
  assert.equal(described.needsSignIn, false)
})

test('401 asks for a reload instead of a retry', () => {
  const described = describeError(fetchError(401, 'Unauthorized'))
  assert.equal(described.needsSignIn, true)
  assert.equal(described.canRetry, false)
})

test('404 and bad input are not retryable', () => {
  assert.equal(describeError(fetchError(404, 'Not found')).canRetry, false)
  const invalid = describeError(fetchError(400, 'Bad request', { message: 'Title is required' }))
  assert.equal(invalid.title, 'Check what you entered')
  assert.equal(invalid.message, 'Title is required')
  assert.equal(invalid.canRetry, false)
})

test('server failures keep the server message and allow a retry', () => {
  const unavailable = describeError(fetchError(503, 'x', { message: 'OPENROUTER_API_KEY is not configured' }))
  assert.equal(unavailable.title, 'Temporarily unavailable')
  assert.equal(unavailable.message, 'OPENROUTER_API_KEY is not configured')
  assert.equal(unavailable.canRetry, true)

  const crashed = describeError(fetchError(500, 'x', { message: 'Database timed out' }))
  assert.equal(crashed.title, 'Something went wrong')
  assert.equal(crashed.canRetry, true)
})
