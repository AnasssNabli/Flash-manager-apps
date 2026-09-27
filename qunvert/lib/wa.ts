import { gw, gwResponse, gwResult } from './fm'
import { collapseMirroredThread } from './threadDedupe'

export type WaStatus = {
  connected?: boolean
  isShared?: boolean
  tokenExpired?: boolean
  phoneNumberId?: string
  phone?: {
    displayPhone?: string
    verifiedName?: string
    phoneNumberId?: string
    id?: string
  } | null
  setupChoice?: string | null
}

export type Convo = {
  phone: string
  contactName: string | null
  lastMessage: string | null
  lastTimestamp: string
  unread: number
  direction: string
  needsReply: boolean
  lastInboundAt: string | null
}

export type ThreadMessage = {
  id?: string
  wa_message_id?: string
  direction?: string
  body?: string | null
  type?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  media_url?: string | null
  from_phone?: string | null
  to_phone?: string | null
  timestamp?: string | Date | null
  created_at?: string | Date | null
}

export type WhatsAppLabel = {
  id: string
  name: string
}

function collectLabelNodes(payload: unknown, depth = 0): unknown[] {
  if (!payload || depth > 5) return []
  if (Array.isArray(payload)) {
    const looksLikeLabels = payload.some((item) =>
      typeof item === 'string' ||
      (item && typeof item === 'object' && ('name' in item || 'title' in item || 'label' in item || 'id' in item)),
    )
    if (looksLikeLabels) return payload
    return payload.flatMap((item) => collectLabelNodes(item, depth + 1))
  }
  if (typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  for (const key of ['labels', 'data', 'items', 'tags', 'whatsappLabels', 'businessLabels', 'result']) {
    if (key in record) {
      const found = collectLabelNodes(record[key], depth + 1)
      if (found.length) return found
    }
  }
  if (record.name || record.title || record.label) return [record]
  return []
}

export function parseWhatsAppLabels(payload: unknown): WhatsAppLabel[] {
  const labels: WhatsAppLabel[] = []
  const seen = new Set<string>()
  for (const item of collectLabelNodes(payload)) {
    if (typeof item === 'string') {
      const name = item.trim()
      if (!name || name.length > 80 || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      labels.push({ id: name, name })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = String(record.name || record.title || record.label || record.text || '').trim()
    const id = String(record.id || record.label_id || record.labelId || name).trim()
    if (!name || name.length > 80 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    labels.push({ id, name })
  }
  return labels
}

export function mergeWhatsAppLabels(...groups: Array<WhatsAppLabel[] | undefined>): WhatsAppLabel[] {
  const labels: WhatsAppLabel[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const item of group || []) {
      const name = String(item?.name || '').trim()
      const id = String(item?.id || name).trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      labels.push({ id: id || name, name })
    }
  }
  return labels
}

function inboxOrigin() {
  return (process.env.INBOX_ORIGIN || 'http://127.0.0.1:39008/whatsapp-business').replace(/\/$/, '')
}

function inboxHeaders(token: string, ownerId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'x-fm-token': token,
    'x-internal-app': 'whatsapp-ai-agents',
    ...(ownerId ? { 'x-owner-id': ownerId } : {}),
  }
}

const labelCache = new Map<string, { at: number; labels: WhatsAppLabel[] }>()

function rememberLabels(cacheKey: string, labels: WhatsAppLabel[]) {
  labelCache.set(cacheKey, {
    at: Date.now(),
    labels,
  })
  return labels
}

function statusId(data: unknown, ...keys: string[]): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  for (const key of keys) {
    const value = String(record[key] || '').trim()
    if (value) return value
  }
  return ''
}

async function listLabelsFromInbox(token: string, ownerId?: string): Promise<WhatsAppLabel[]> {
  try {
    const response = await fetch(`${inboxOrigin()}/api/wa/labels`, {
      headers: inboxHeaders(token, ownerId),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return []
    const data = await response.json().catch(() => null)
    return parseWhatsAppLabels(data)
  } catch {
    return []
  }
}

export async function listWhatsAppLabels(token: string, ownerId?: string): Promise<WhatsAppLabel[]> {
  const cacheKey = ownerId || token.slice(-24)
  const cached = labelCache.get(cacheKey)
  const ttl = cached?.labels.length ? 60_000 : 8_000
  if (cached && Date.now() - cached.at < ttl) return cached.labels

  const fromInbox = await listLabelsFromInbox(token, ownerId)
  if (fromInbox.length) return rememberLabels(cacheKey, fromInbox)

  const status = await gwResult('/v1/whatsapp/status', token)
  const wabaId = statusId(status.data, 'wabaId', 'waba_id')
  const phoneNumberId = statusId(status.data, 'phoneNumberId', 'phone_number_id')
  const paths = [
    '/v1/whatsapp/labels',
    '/v1/whatsapp/business-labels',
    '/v1/whatsapp/tags',
    '/v1/whatsapp/graph/labels',
    '/v1/whatsapp/conversation-labels',
    '/v1/whatsapp/assigned-labels',
  ]
  if (wabaId) {
    paths.push(
      `/v1/whatsapp/graph/${encodeURIComponent(wabaId)}/labels`,
      `/v1/whatsapp/graph?path=${encodeURIComponent(`/${wabaId}/labels`)}`,
      `/v1/whatsapp/${encodeURIComponent(wabaId)}/labels`,
    )
  }
  if (phoneNumberId) {
    paths.push(`/v1/whatsapp/phone/${encodeURIComponent(phoneNumberId)}/labels`)
  }

  for (const path of paths) {
    const result = await gwResult(path, token)
    if (!result.ok) continue
    const labels = parseWhatsAppLabels(result.data)
    if (labels.length) return rememberLabels(cacheKey, labels)
  }

  return rememberLabels(cacheKey, [])
}

export function matchWhatsAppLabel(labels: WhatsAppLabel[], configured: string): WhatsAppLabel | null {
  const wanted = configured.trim().toLowerCase()
  if (!wanted) return null
  return labels.find((item) => item.id.toLowerCase() === wanted || item.name.toLowerCase() === wanted) || null
}

export async function applyWhatsAppLabel(
  token: string,
  phone: string,
  label: WhatsAppLabel | string,
  ownerId?: string,
): Promise<void> {
  const configured = typeof label === 'string' ? label.trim() : (label.name || label.id).trim()
  if (!configured || !phone) return
  const live = matchWhatsAppLabel(await listWhatsAppLabels(token, ownerId), configured)
    || (typeof label === 'string' ? null : label)
  if (!live?.name && !live?.id) return
  const name = live.name || configured
  const id = live.id || name
  const payload = { phone, to: phone, label: name, name, labelId: id, id, label_id: id }
  try {
    const inbox = await fetch(`${inboxOrigin()}/api/wa/labels`, {
      method: 'POST',
      headers: {
        ...inboxHeaders(token, ownerId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (inbox.ok) return
  } catch {
    // Fall through to the app gateway.
  }
  for (const path of ['/v1/whatsapp/labels', '/v1/whatsapp/conversations/label']) {
    const result = await gwResult(path, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (result.ok) return
  }
}

export async function waStatus(token: string): Promise<WaStatus> {
  try {
    return await gw<WaStatus>('/v1/whatsapp/status', token)
  } catch {
    return {}
  }
}

export async function listConvos(token: string, filter = 'all', limit = 80, search = ''): Promise<Convo[]> {
  const q = new URLSearchParams({ filter, limit: String(limit) })
  if (search.trim()) q.set('search', search.trim())
  const res = await gw<{ conversations?: Convo[] }>(`/v1/whatsapp/conversations?${q}`, token)
  return Array.isArray(res?.conversations) ? res.conversations : []
}

export async function getThread(token: string, phone: string): Promise<ThreadMessage[]> {
  const q = new URLSearchParams({ phone })
  const res = await gw<{ messages?: ThreadMessage[] }>(`/v1/whatsapp/conversations?${q}`, token)
  const messages = Array.isArray(res?.messages) ? res.messages : []
  return collapseMirroredThread(messages)
}

export type SendResult = { ok: boolean; error?: string; messageId?: string }

export async function sendMessage(
  token: string,
  payload:
    | { to: string; type: 'text'; text: string }
    | { to: string; type: 'image' | 'video'; mediaId: string; caption?: string }
    | { to: string; type: 'audio'; mediaId: string; duration?: number }
    | { to: string; type: 'document'; mediaId: string; caption?: string },
): Promise<SendResult> {
  try {
    const res = await gw<{ success?: boolean; error?: string; messageId?: string; message_id?: string }>('/v1/whatsapp/send', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res?.success) return { ok: true, messageId: res.messageId || res.message_id }
    return { ok: false, error: res?.error || 'send_failed' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send_failed' }
  }
}

export async function sendText(token: string, to: string, text: string): Promise<SendResult> {
  return sendMessage(token, { to, type: 'text', text })
}

export async function uploadWhatsAppMedia(
  token: string,
  bytes: Uint8Array,
  opts: { name: string; contentType: string; mediaType: 'image' | 'video' | 'audio' | 'document' },
): Promise<string> {
  const form = new FormData()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  form.append('file', new Blob([copy.buffer], { type: opts.contentType }), opts.name)
  form.append('mediaType', opts.mediaType)
  const response = await gw<{ mediaId?: string; error?: string }>('/v1/whatsapp/media/upload', token, {
    method: 'POST',
    body: form,
  })
  if (!response.mediaId) throw new Error(response.error || 'whatsapp_media_upload_failed')
  return response.mediaId
}

async function mediaFromResponse(response: Response): Promise<{ bytes: Buffer; contentType: string }> {
  if (!response.ok) throw new Error(`whatsapp_media_${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.byteLength) throw new Error('whatsapp_media_empty')
  return {
    bytes,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

export async function downloadWhatsAppMedia(
  token: string,
  mediaId: string,
  ownerId?: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const id = String(mediaId || '').trim()
  if (!id) throw new Error('whatsapp_media_missing')
  if (/^https?:\/\//i.test(id)) {
    const response = await fetch(id, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    return mediaFromResponse(response)
  }

  try {
    const response = await gwResponse(`/v1/whatsapp/media/${encodeURIComponent(id)}`, token)
    return mediaFromResponse(response)
  } catch (error) {
    if (!ownerId) throw error
    const response = await fetch(`${inboxOrigin()}/api/wa/media/${encodeURIComponent(id)}`, {
      headers: inboxHeaders(token, ownerId),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    return mediaFromResponse(response)
  }
}

export function inCustomerWindow(lastInboundAt: string | null | undefined): boolean {
  if (!lastInboundAt) return false
  const t = new Date(lastInboundAt).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t < 24 * 60 * 60 * 1000
}

export function messageId(msg: ThreadMessage): string {
  return String(msg.wa_message_id || msg.id || '').trim()
}

export function messageBody(msg: ThreadMessage): string {
  return String(msg.body || '').trim()
}

export function messageTime(msg: ThreadMessage): number {
  const raw = msg.timestamp || msg.created_at
  const t = raw ? new Date(raw).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

export function lastInbound(messages: ThreadMessage[]): ThreadMessage | null {
  const inbound = messages.filter((m) => m.direction === 'inbound')
  if (!inbound.length) return null
  return inbound.reduce((a, b) => (messageTime(a) >= messageTime(b) ? a : b))
}
