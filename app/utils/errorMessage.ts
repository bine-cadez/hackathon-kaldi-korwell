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
