export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { listInboxConversations, type InboxChannel } from '@/lib/inbox'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channel = String(body.channel || 'whatsapp') as InboxChannel
  if (!['whatsapp', 'instagram', 'facebook'].includes(channel)) {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 })
  }

  const result = await listInboxConversations({
    ownerId: owner.ownerId,
    token: owner.token,
    channel,
    accountId: body.accountId ? String(body.accountId) : undefined,
    search: body.search ? String(body.search) : '',
  })
  return NextResponse.json(result)
}
