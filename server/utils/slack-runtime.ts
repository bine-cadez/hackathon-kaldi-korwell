interface Waitable {
  waitUntil?: (promise: Promise<unknown>) => void
}

// Ack Slack before directory lookups. Keep the promise on the Workers execution
// context (`waitUntil`) and do not detach the method from its receiver.
export function deferAfterResponse (event: {
  context: Record<string, unknown> & {
    cloudflare?: { context?: Waitable, ctx?: Waitable }
    waitUntil?: (promise: Promise<unknown>) => void
  }
  waitUntil?: (promise: Promise<unknown>) => void
}, work: Promise<unknown>) {
  const cloudflare = event.context.cloudflare
  const holders: Array<Waitable | undefined> = [
    cloudflare?.context,
    cloudflare?.ctx,
    event.context,
    event
  ]
  for (const holder of holders) {
    if (holder && typeof holder.waitUntil === 'function') {
      holder.waitUntil(work)
      return
    }
  }
  work.catch((error) => {
    console.error(JSON.stringify({
      message: 'slack_event_failed',
      error: error instanceof Error ? error.message : String(error)
    }))
  })
}
