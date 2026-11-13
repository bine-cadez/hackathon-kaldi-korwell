// Query errors caught during SSR (`ssrCatchError` in colada.options.ts) travel to
// the browser in the Nuxt payload, which cannot serialize Error subclasses such
// as ofetch's FetchError. Send only what ErrorState needs: never the stack.
// https://pinia-colada.esm.dev/nuxt.html
interface SerializedError {
  name: string
  message: string
  statusCode?: number
  statusMessage?: string
}

export default definePayloadPlugin(() => {
  definePayloadReducer('FetchError', (value: unknown) => {
    // NuxtError has its own reducer in Nuxt; leave it alone.
    if (!(value instanceof Error) || isNuxtError(value)) return false
    const record = value as Error & { statusCode?: number, statusMessage?: string }
    return {
      name: record.name,
      message: errorMessage(record),
      statusCode: record.statusCode,
      statusMessage: record.statusMessage
    } satisfies SerializedError
  })

  definePayloadReviver('FetchError', (data: SerializedError) => {
    const error = new Error(data.message) as Error & { statusCode?: number, statusMessage?: string, data?: { message: string } }
    error.name = data.name
    error.statusCode = data.statusCode
    error.statusMessage = data.statusMessage
    error.data = { message: data.message }
    return error
  })
})
