export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { sendInboxMessage, type InboxChannel, type InboxMedia } from '@/lib/inbox'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channel = String(body.channel || 'whatsapp') as InboxChannel
  const chatId = String(body.chatId || '').trim()
  const text = String(body.text || '')
  const rawMedia = body.media && typeof body.media === 'object' ? body.media as Record<string, unknown> : null
  const kind: InboxMedia['kind'] | null = rawMedia?.kind === 'image' || rawMedia?.kind === 'audio' || rawMedia?.kind === 'video'
    ? rawMedia.kind
    : null
  const media: InboxMedia | null = rawMedia && kind
    ? {
        kind,
        filename: String(rawMedia.filename || 'file'),
        mime: String(rawMedia.mime || ''),
        data: String(rawMedia.data || ''),
      }
    : null
  if (!chatId || !['whatsapp', 'instagram', 'facebook'].includes(channel) || (!text.trim() && !media?.data)) {
    return NextResponse.json({ error: 'invalid_send' }, { status: 400 })
  }

  const result = await sendInboxMessage({
    ownerId: owner.ownerId,
    token: owner.token,
    channel,
    chatId,
    recipientId: String(body.recipientId || chatId),
    accountId: body.accountId ? String(body.accountId) : undefined,
    text,
    media,
  })
  if (!result.ok) return NextResponse.json({ error: result.error || 'send_failed' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
