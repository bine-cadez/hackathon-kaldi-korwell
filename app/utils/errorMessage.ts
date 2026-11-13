export function errorMessage (error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as {
      data?: { message?: string, statusMessage?: string, data?: { message?: string } }
      statusMessage?: string
      message?: string
    }
    return record.data?.message
      || record.data?.data?.message
      || record.data?.statusMessage
      || record.statusMessage
      || record.message
      || 'Request failed'
  }
  return 'Request failed'
}

export interface ErrorDescription {
  /** HTTP status, or undefined when the request never got a response. */
  status?: number
  title: string
  message: string
  /** Whether trying the same request again can help. */
  canRetry: boolean
  /** The site password or Access session is missing; only a reload helps. */
  needsSignIn: boolean
}

export function errorStatus (error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return record.statusCode ?? record.status ?? record.response?.status
}

function isNetworkError (error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = error instanceof Error ? error.message : ''
  return /no response|failed to fetch|networkerror|load failed/i.test(message)
}

// Turns any fetch error into words a person can act on. The server's own
// message is kept as the detail when it has one.
export function describeError (error: unknown): ErrorDescription {
  const status = errorStatus(error)
  const detail = errorMessage(error)
  const base = { status, needsSignIn: false }

  if (status === undefined && isNetworkError(error)) {
    return { ...base, title: 'Can’t reach the archive', message: 'Check your connection, then try again.', canRetry: true }
  }
  switch (status) {
    case 401:
      return { ...base, title: 'Your session has ended', message: 'Reload the page to unlock the archive again.', canRetry: false, needsSignIn: true }
    case 403:
      return { ...base, title: 'Not allowed', message: detail, canRetry: false }
    case 404:
      return { ...base, title: 'Not found', message: 'It may have been deleted. Refresh the list and try again.', canRetry: false }
    case 400:
    case 413:
    case 422:
      return { ...base, title: 'Check what you entered', message: detail, canRetry: false }
    case 429:
      return { ...base, title: 'Too many requests', message: 'Wait a moment, then try again.', canRetry: true }
    case 503:
      return { ...base, title: 'Temporarily unavailable', message: detail, canRetry: true }
    default:
      return { ...base, title: 'Something went wrong', message: detail, canRetry: true }
  }
}
