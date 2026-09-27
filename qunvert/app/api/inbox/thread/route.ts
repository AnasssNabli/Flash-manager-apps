export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { listInboxThread, type InboxChannel } from '@/lib/inbox'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channel = String(body.channel || 'whatsapp') as InboxChannel
  const chatId = String(body.chatId || '').trim()
  if (!chatId || !['whatsapp', 'instagram', 'facebook'].includes(channel)) {
    return NextResponse.json({ error: 'invalid_thread' }, { status: 400 })
  }

  const messages = await listInboxThread({
    ownerId: owner.ownerId,
    token: owner.token,
    channel,
    chatId,
    accountId: body.accountId ? String(body.accountId) : undefined,
  })
  return NextResponse.json({ messages })
}
