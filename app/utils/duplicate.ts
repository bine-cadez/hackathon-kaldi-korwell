export interface DuplicateDocument {
  id: string
  title: string
  createdAt: string
}

// The 409 from POST /api/documents carries the document that already has this
// content. $fetch puts the server's `data` under error.data.data.
export function duplicateOf (error: unknown): DuplicateDocument | null {
  if (!error || typeof error !== 'object' || errorStatus(error) !== 409) return null
  const data = (error as { data?: { duplicate?: unknown, data?: { duplicate?: unknown } } }).data
  const duplicate = (data?.data?.duplicate ?? data?.duplicate) as Partial<DuplicateDocument> | undefined
  return duplicate && typeof duplicate.id === 'string' && typeof duplicate.title === 'string'
    ? { id: duplicate.id, title: duplicate.title, createdAt: String(duplicate.createdAt ?? '') }
    : null
}
