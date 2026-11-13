import { createError } from 'h3'

// Shared by document search (created_at) and Slack search (message ts).
// Inclusive UTC calendar dates; `to` covers that whole UTC day.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface UtcDateRange {
  from: string | null
  toExclusive: string | null
}

function badRequest (message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

export function isCalendarDate (value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

export function nextUtcDate (value: string): string {
  const match = ISO_DATE.exec(value)
  if (!match) return value
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  utc.setUTCDate(utc.getUTCDate() + 1)
  return utc.toISOString().slice(0, 10)
}

export function utcMidnightSeconds (value: string): number {
  const match = ISO_DATE.exec(value)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000
}

// Validates and normalizes; throws a 400 with the same messages both searches used.
export function parseUtcDateRange (from?: string | null, to?: string | null): UtcDateRange {
  const start = (from ?? '').trim() || null
  const end = (to ?? '').trim() || null
  if (start && !isCalendarDate(start)) badRequest('from must be a calendar date (YYYY-MM-DD)')
  if (end && !isCalendarDate(end)) badRequest('to must be a calendar date (YYYY-MM-DD)')
  if (start && end && start > end) badRequest('from must be on or before to')
  return { from: start, toExclusive: end ? nextUtcDate(end) : null }
}
