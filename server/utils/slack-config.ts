export interface SlackSettings {
  signingSecret: string
  botToken: string
  channelIds: string[]
}

export function parseChannelIds (value: string | null | undefined): string[] {
  if (!value) return []
  const seen = new Set<string>()
  for (const part of value.split(/[\s,]+/)) {
    const id = part.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

export function slackSettings (env?: {
  SLACK_SIGNING_SECRET?: string
  SLACK_BOT_TOKEN?: string
  SLACK_CHANNEL_IDS?: string
} | null): SlackSettings {
  const signingSecret = first(env?.SLACK_SIGNING_SECRET, process.env.SLACK_SIGNING_SECRET)
  const botToken = first(env?.SLACK_BOT_TOKEN, process.env.SLACK_BOT_TOKEN)
  const channelIds = parseChannelIds(first(env?.SLACK_CHANNEL_IDS, process.env.SLACK_CHANNEL_IDS))
  return { signingSecret, botToken, channelIds }
}

export function channelAllowed (channelIds: readonly string[], channelId: string | null | undefined): boolean {
  if (!channelId) return false
  return channelIds.includes(channelId)
}

function first (binding: string | undefined, fromProcess: string | undefined): string {
  const fromBinding = (binding ?? '').trim()
  if (fromBinding) return fromBinding
  return (fromProcess ?? '').trim()
}
