import { clampMaxResponses, comparablePhone, normalizedStopWord } from './agentConfig'

export type HumanModeState = 'ai_active' | 'human_requested' | 'human_active' | 'stopped'

export function parseIgnoredNumbers(raw: string): string[] {
  return String(raw || '')
    .split(/\r?\n|,/)
    .map(comparablePhone)
    .filter(Boolean)
}

export function isBlockedPhone(ignoredNumbers: string, phone: string): boolean {
  const candidate = comparablePhone(phone)
  if (!candidate) return false
  return parseIgnoredNumbers(ignoredNumbers).includes(candidate)
}

export function matchesStopWord(stopWord: string, message: string): boolean {
  const expected = normalizedStopWord(stopWord)
  if (!expected) return false
  return normalizedStopWord(message) === expected
}

export function isOlderHumanConversation(opts: {
  answerOlderConversations: boolean
  isFirstCustomerMessage: boolean
  agentHasReplied: boolean
  humanOutboundCount: number
}): boolean {
  if (opts.answerOlderConversations) return false
  if (opts.isFirstCustomerMessage) return false
  if (opts.agentHasReplied) return false
  return opts.humanOutboundCount >= 2
}

export function humanTookOver(latestHumanAt: number | null | undefined, lastAiSentAt: number | null | undefined): boolean {
  if (!latestHumanAt) return false
  return latestHumanAt > (lastAiSentAt || 0)
}

function latestTime(...values: Array<Date | number | null | undefined>): number | null {
  let max = 0
  for (const value of values) {
    const time = value instanceof Date ? value.getTime() : Number(value || 0)
    if (Number.isFinite(time) && time > max) max = time
  }
  return max > 0 ? max : null
}

export function shouldPauseForHuman(opts: {
  resumeAfterTakeover: boolean
  resumeAfterMinutes: number
  isFirstCustomerMessage: boolean
  state: HumanModeState
  humanTookOver: boolean
  lastHumanAt?: Date | null
  humanRequestedAt?: Date | null
  lastCustomerAt?: Date | null
  now?: number
}): boolean {
  if (opts.state === 'stopped') return true
  const now = opts.now ?? Date.now()
  const quietMs = Math.max(0, opts.resumeAfterMinutes) * 60 * 1000

  if (opts.state === 'human_requested') {
    if (!opts.resumeAfterTakeover || quietMs <= 0) return true
    const last = latestTime(opts.humanRequestedAt, opts.lastHumanAt, opts.lastCustomerAt)
    if (!last) return true
    return now - last <= quietMs
  }

  if (opts.isFirstCustomerMessage) return false
  if (!opts.resumeAfterTakeover || quietMs <= 0) return false
  if (!opts.humanTookOver && opts.state !== 'human_active') return false
  const last = latestTime(opts.lastHumanAt, opts.lastCustomerAt)
  if (!last) return true
  return now - last <= quietMs
}

export function promisedHumanHandoff(text: string): boolean {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  return /(connect( you)? (with|to)|attach(e)? you|transfer you|put you through|hand( you)? over|pass you (to|over)|notify.{0,40}(human|team|agent|support|person)|human support|speak (to|with) (a )?(human|person|agent)|un conseiller|un humain|quelqu'un (de )?(l['’])?équipe|نحولك|حولك|حوّلك|فريق)/i.test(value)
}

export function remainingResponseBudget(maxResponses: number, alreadySent: number): number {
  return Math.max(0, clampMaxResponses(maxResponses) - Math.max(0, alreadySent))
}

export function overResponseBudget(maxResponses: number, alreadySent: number, planned: number): boolean {
  return planned > remainingResponseBudget(maxResponses, alreadySent)
}

export function hitAiReplyLimit(maxResponses: number, alreadySent: number): boolean {
  return remainingResponseBudget(maxResponses, alreadySent) <= 0
}

export function shouldWaitForRapidBatch(latestInboundAt: number, now = Date.now(), windowMs = 5000): boolean {
  if (!Number.isFinite(latestInboundAt) || latestInboundAt <= 0) return false
  return now - latestInboundAt < windowMs
}

export function scoreProduct(query: string, name: string, description?: string | null): number {
  const haystack = `${name} ${description || ''}`.toLowerCase()
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 2)
  if (!tokens.length) return 0
  return tokens.reduce((score, token) => {
    if (name.toLowerCase().includes(token)) return score + 5
    if (haystack.includes(token)) return score + 1
    return score
  }, 0)
}

export function overflowManagedLabelIds(idsNewestFirst: string[], keep = 3): string[] {
  return idsNewestFirst.slice(Math.max(0, keep))
}
