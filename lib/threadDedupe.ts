export type ThreadMsg = {
  id?: string
  wa_message_id?: string | null
  direction?: string | null
  from_phone?: string | null
  to_phone?: string | null
  body?: string | null
  type?: string | null
  timestamp?: string | Date | null
  created_at?: string | Date | null
  media_url?: string | null
  metadata?: Record<string, unknown> | null
}

const MIRROR_WINDOW_MS = 4_000

export function phoneDigits(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : digits
}

function metaOf(msg: ThreadMsg): Record<string, unknown> {
  return msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {}
}

export function messageTime(msg: ThreadMsg): number {
  const raw = msg.timestamp || msg.created_at
  const time = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function mediaId(msg: ThreadMsg): string {
  const meta = metaOf(msg)
  const nested = [meta.image, meta.video, meta.audio, meta.document, meta.sticker]
  const candidates = [
    msg.media_url,
    meta.media_url,
    meta.media_id,
    meta.mediaId,
    ...nested.map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null)),
  ]
  for (const value of candidates) {
    const id = String(value || '').trim()
    if (id && !id.startsWith('wamid.')) return id
  }
  return ''
}

export function isBusinessEcho(msg: ThreadMsg): boolean {
  const meta = metaOf(msg)
  if (meta.from_me === true || meta.echo === true || meta.smb === true) return true
  const source = String(meta.source || meta.origin || meta.message_source || '').toLowerCase()
  return /smb_message_echo|smb_echo|business_echo|from_me|whatsapp_business_app/.test(source)
}

export function collectBusinessPhones(
  messages: ThreadMsg[],
  extra: Array<string | null | undefined> = [],
): Set<string> {
  const phones = new Set<string>()
  const add = (value: string | null | undefined) => {
    const digits = phoneDigits(value)
    if (digits.length >= 8) phones.add(digits)
  }
  for (const value of extra) add(value)
  // Only the number that received inbound mail is the business line.
  // Outbound `from_phone` is often a Meta id — or the customer — and must not
  // be treated as the seller, or every customer bubble flips to green.
  for (const msg of messages) {
    if (msg.direction === 'inbound') add(msg.to_phone)
  }
  return phones
}

function isBusinessSender(msg: ThreadMsg, businessPhones: Set<string>): boolean {
  const from = phoneDigits(msg.from_phone)
  return !!from && businessPhones.has(from)
}

function fingerprint(msg: ThreadMsg): string | null {
  const body = String(msg.body || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (body) return `text:${body}`
  const media = mediaId(msg)
  if (media) return `media:${media}`
  return null
}

function preferKeepIndex<T extends ThreadMsg>(
  messages: T[],
  original: T[],
  a: number,
  b: number,
): number {
  const origOutA = original[a]?.direction === 'outbound' ? 1 : 0
  const origOutB = original[b]?.direction === 'outbound' ? 1 : 0
  if (origOutA !== origOutB) return origOutA > origOutB ? a : b
  const outA = messages[a]?.direction === 'outbound' ? 1 : 0
  const outB = messages[b]?.direction === 'outbound' ? 1 : 0
  if (outA !== outB) return outA > outB ? a : b
  return a < b ? a : b
}

/**
 * Phone-sent seller messages can land twice: once as outbound (correct) and
 * once as inbound (echo). Keep a single business-side copy. Never turn a real
 * customer inbound into outbound.
 */
export function collapseMirroredThread<T extends ThreadMsg>(
  messages: T[],
  extraBusinessPhones: Array<string | null | undefined> = [],
): T[] {
  if (!messages.length) return messages

  const businessPhones = collectBusinessPhones(messages, extraBusinessPhones)
  const normalized = messages.map((msg) => {
    if (msg.direction === 'outbound') return msg
    if (isBusinessEcho(msg) || isBusinessSender(msg, businessPhones)) {
      return { ...msg, direction: 'outbound' as T['direction'] }
    }
    return msg
  })

  const drop = new Set<number>()
  const byWamid = new Map<string, number[]>()
  normalized.forEach((msg, index) => {
    const id = String(msg.wa_message_id || '').trim()
    if (!id) return
    const list = byWamid.get(id) || []
    list.push(index)
    byWamid.set(id, list)
  })
  for (const indexes of byWamid.values()) {
    if (indexes.length < 2) continue
    let keep = indexes[0]
    for (const index of indexes.slice(1)) keep = preferKeepIndex(normalized, messages, keep, index)
    for (const index of indexes) if (index !== keep) drop.add(index)
  }

  for (let i = 0; i < normalized.length; i++) {
    if (drop.has(i)) continue
    const key = fingerprint(normalized[i])
    if (!key) continue
    const time = messageTime(normalized[i])
    for (let j = i + 1; j < normalized.length; j++) {
      if (drop.has(j)) continue
      if (fingerprint(normalized[j]) !== key) continue
      if (Math.abs(messageTime(normalized[j]) - time) > MIRROR_WINDOW_MS) continue
      const keep = preferKeepIndex(normalized, messages, i, j)
      const lose = keep === i ? j : i
      drop.add(lose)
      if (lose === i) break
    }
  }

  return normalized.filter((_, index) => !drop.has(index))
}
