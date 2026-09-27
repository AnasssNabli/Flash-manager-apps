import { prisma } from './db'
import { getThread, listConvos, sendText } from './wa'

export type InboxChannel = 'whatsapp' | 'instagram' | 'facebook'

export type InboxConversation = {
  id: string
  channel: InboxChannel
  accountId: string
  recipientId: string
  name: string
  lastMessage: string
  lastTimestamp: string
  unread: number
}

export type InboxMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  type: string
  timestamp: string
  status: string | null
}

const IG_GRAPH = 'https://graph.instagram.com/v23.0'
const FB_GRAPH = 'https://graph.facebook.com/v23.0'

async function graphJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: init?.signal || AbortSignal.timeout(15_000) })
  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  const err = data?.error as { message?: string } | undefined
  if (!response.ok || !data || err) {
    throw new Error(String(err?.message || data?.error_message || `HTTP ${response.status}`))
  }
  return data
}

function recordList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return recordList((value as { data: unknown }).data)
  }
  return []
}

async function loadAccount(ownerId: string, channel: InboxChannel, accountId?: string) {
  return prisma.metaAccount.findFirst({
    where: {
      ownerId,
      provider: channel,
      status: 'connected',
      ...(accountId ? { id: accountId } : {}),
    },
    orderBy: { connectedAt: 'desc' },
  })
}

export async function listInboxAccounts(ownerId: string, channel: InboxChannel) {
  const accounts = await prisma.metaAccount.findMany({
    where: { ownerId, provider: channel, status: 'connected' },
    orderBy: { connectedAt: 'desc' },
  })
  return accounts.map((account) => ({
    id: account.id,
    displayName: channel === 'instagram' && account.username
      ? `@${account.username}`
      : account.displayName || (channel === 'instagram' ? 'Instagram' : 'Facebook Page'),
  }))
}

function participantName(row: Record<string, unknown>, selfIds: Set<string>) {
  const people = recordList(row.participants)
  const other = people.find((person) => !selfIds.has(String(person.id || ''))) || people[0]
  return {
    recipientId: String(other?.id || row.id || ''),
    name: String(other?.username || other?.name || 'Customer'),
  }
}

function latestSnippet(row: Record<string, unknown>) {
  const messages = recordList(row.messages)
  const last = messages[0]
  return {
    lastMessage: String(last?.message || last?.text || ''),
    lastTimestamp: String(last?.created_time || row.updated_time || new Date().toISOString()),
  }
}

async function listMetaConversations(account: {
  id: string
  provider: string
  externalId: string
  accessToken: string
}): Promise<InboxConversation[]> {
  const channel = account.provider === 'facebook' ? 'facebook' : 'instagram'
  const selfIds = new Set([account.externalId])
  const fields = 'id,updated_time,unread_count,participants{id,name,username},messages.limit(1){id,message,from,created_time}'
  const url = channel === 'instagram'
    ? `${IG_GRAPH}/me/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(account.accessToken)}`
    : `${FB_GRAPH}/${encodeURIComponent(account.externalId)}/conversations?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(account.accessToken)}`
  const data = await graphJson(url)
  return recordList(data.data).map((row) => {
    const person = participantName(row, selfIds)
    const snippet = latestSnippet(row)
    return {
      id: String(row.id),
      channel,
      accountId: account.id,
      recipientId: person.recipientId,
      name: person.name,
      lastMessage: snippet.lastMessage,
      lastTimestamp: snippet.lastTimestamp,
      unread: Number(row.unread_count || 0),
    }
  })
}

async function listMetaThread(account: {
  provider: string
  externalId: string
  username?: string | null
  accessToken: string
}, conversationId: string): Promise<InboxMessage[]> {
  const fields = 'messages.limit(80){id,message,from,created_time,attachments}'
  const base = account.provider === 'facebook' ? FB_GRAPH : IG_GRAPH
  const data = await graphJson(
    `${base}/${encodeURIComponent(conversationId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(account.accessToken)}`,
  )
  const selfIds = new Set([account.externalId])
  const selfNames = new Set(
    [account.username].filter(Boolean).map((name) => String(name).replace(/^@/, '').toLowerCase()),
  )
  const messages = recordList((data.messages as { data?: unknown } | undefined)?.data || data.messages)
  return messages
    .map((row) => {
      const from = row.from && typeof row.from === 'object' ? row.from as Record<string, unknown> : {}
      const fromId = String(from.id || '')
      const fromName = String(from.username || from.name || '').replace(/^@/, '').toLowerCase()
      const outbound = selfIds.has(fromId) || (fromName.length > 0 && selfNames.has(fromName))
      return {
        id: String(row.id),
        direction: (outbound ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
        body: String(row.message || ''),
        type: 'text',
        timestamp: String(row.created_time || new Date().toISOString()),
        status: outbound ? 'sent' : null,
      }
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

export type InboxMedia = {
  kind: 'image' | 'audio' | 'video'
  filename: string
  mime: string
  data: string
}

const MEDIA_MIME: Record<InboxMedia['kind'], string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a'],
  video: ['video/mp4'],
}

async function sendMetaMessage(account: {
  provider: string
  externalId: string
  accessToken: string
}, recipientId: string, text: string) {
  const payload = JSON.stringify({
    recipient: { id: recipientId },
    message: { text },
  })
  if (account.provider === 'facebook') {
    await graphJson(`${FB_GRAPH}/${encodeURIComponent(account.externalId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text },
        access_token: account.accessToken,
      }),
    })
    return
  }
  await graphJson(`${IG_GRAPH}/me/messages?access_token=${encodeURIComponent(account.accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
}

async function sendMetaAttachment(account: {
  provider: string
  externalId: string
  accessToken: string
}, recipientId: string, media: InboxMedia) {
  const mime = media.mime.split(';')[0].trim().toLowerCase()
  if (!MEDIA_MIME[media.kind]?.includes(mime)) throw new Error('This file type cannot be sent.')
  const bytes = Buffer.from(media.data, 'base64')
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('File is too large.')
  const form = new FormData()
  form.set('recipient', JSON.stringify({ id: recipientId }))
  form.set('message', JSON.stringify({ attachment: { type: media.kind, payload: {} } }))
  form.set('filedata', new File([new Uint8Array(bytes)], media.filename.slice(0, 80) || `file.${media.kind}`, { type: mime }))
  const endpoint = account.provider === 'facebook'
    ? `${FB_GRAPH}/${encodeURIComponent(account.externalId)}/messages`
    : `${IG_GRAPH}/me/messages`
  await graphJson(`${endpoint}?access_token=${encodeURIComponent(account.accessToken)}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
}

export async function listInboxConversations(opts: {
  ownerId: string
  token: string
  channel: InboxChannel
  accountId?: string
  search?: string
}): Promise<{ conversations: InboxConversation[]; accounts: { id: string; displayName: string }[] }> {
  if (opts.channel === 'whatsapp') {
    const convos = await listConvos(opts.token, 'all', 80, opts.search || '')
    return {
      accounts: [],
      conversations: convos.map((convo) => ({
        id: convo.phone,
        channel: 'whatsapp' as const,
        accountId: 'whatsapp',
        recipientId: convo.phone,
        name: convo.contactName || convo.phone,
        lastMessage: convo.lastMessage || '',
        lastTimestamp: convo.lastTimestamp,
        unread: convo.unread || 0,
      })),
    }
  }

  const accounts = await listInboxAccounts(opts.ownerId, opts.channel)
  const account = await loadAccount(opts.ownerId, opts.channel, opts.accountId)
  if (!account) return { conversations: [], accounts }

  try {
    const conversations = await listMetaConversations(account)
    const query = (opts.search || '').trim().toLowerCase()
    return {
      accounts,
      conversations: query
        ? conversations.filter((item) =>
            `${item.name} ${item.lastMessage}`.toLowerCase().includes(query),
          )
        : conversations,
    }
  } catch (error) {
    console.error('[inbox-list]', opts.channel, (error as Error).message)
    return { conversations: [], accounts }
  }
}

export async function listInboxThread(opts: {
  ownerId: string
  token: string
  channel: InboxChannel
  chatId: string
  accountId?: string
}): Promise<InboxMessage[]> {
  if (opts.channel === 'whatsapp') {
    const thread = await getThread(opts.token, opts.chatId)
    return thread.map((message) => ({
      id: String(message.wa_message_id || message.id || `${message.timestamp}`),
      direction: message.direction === 'outbound' ? 'outbound' : 'inbound',
      body: String(message.body || ''),
      type: String(message.type || 'text'),
      timestamp: String(message.timestamp || message.created_at || new Date().toISOString()),
      status: message.status || null,
    }))
  }

  const account = await loadAccount(opts.ownerId, opts.channel, opts.accountId)
  if (!account) return []
  try {
    return await listMetaThread(account, opts.chatId)
  } catch (error) {
    console.error('[inbox-thread]', opts.channel, (error as Error).message)
    return []
  }
}

export async function sendInboxMessage(opts: {
  ownerId: string
  token: string
  channel: InboxChannel
  chatId: string
  recipientId: string
  accountId?: string
  text: string
  media?: InboxMedia | null
}): Promise<{ ok: boolean; error?: string }> {
  const text = opts.text.trim()
  const media = opts.media
  if (!text && !media) return { ok: false, error: 'empty' }

  if (opts.channel === 'whatsapp') {
    if (!text) return { ok: false, error: 'empty' }
    const sent = await sendText(opts.token, opts.chatId, text)
    return sent.ok ? { ok: true } : { ok: false, error: sent.error || 'send_failed' }
  }

  const account = await loadAccount(opts.ownerId, opts.channel, opts.accountId)
  if (!account) return { ok: false, error: 'account_not_available' }
  try {
    if (media) await sendMetaAttachment(account, opts.recipientId || opts.chatId, media)
    else await sendMetaMessage(account, opts.recipientId || opts.chatId, text)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'send_failed' }
  }
}
