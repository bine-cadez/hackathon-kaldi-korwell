import { createError, defineEventHandler, readBody } from 'h3'
import { requireEnv, toHttpError } from '../../utils/env'
import { RESET_CONFIRMATION, resetLibrary } from '../../utils/library-reset'

// POST /api/admin/reset { confirm: "RESET" }: deletes every uploaded document.
// Behind the same site lock as the rest of /api (Access or the site password).
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event).catch(() => null) as { confirm?: unknown } | null
    if (body?.confirm !== RESET_CONFIRMATION) {
      const message = `Send { "confirm": "${RESET_CONFIRMATION}" } to delete every document.`
      throw createError({ statusCode: 400, statusMessage: 'Reset not confirmed', data: { message } })
    }
    const env = requireEnv(event)
    const user = event.context.korwellAccessUser as { email?: string } | undefined
    console.log(JSON.stringify({ message: 'library_reset_requested', by: user?.email ?? null }))
    return await resetLibrary(env)
  } catch (error) {
    throw toHttpError(error)
  }
})
