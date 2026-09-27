export const dynamic = 'force-dynamic'

import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { enqueueConversation } from '@/lib/replyQueue'

const MAX_SKEW_MS = 5 * 60 * 1000

function validSignature(req: Request, raw: string): boolean {
  const secret = process.env.FM_APP_SECRET
  const timestamp = req.headers.get('x-fm-timestamp') || ''
  const signature = (req.headers.get('x-fm-signature') || '').replace(/^sha256=/, '')
  const sentAt = Number(timestamp) * 1000
  if (!secret || !signature || !Number.isFinite(sentAt)) return false
  if (Math.abs(Date.now() - sentAt) > MAX_SKEW_MS) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest()
  const received = Buffer.from(signature, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function POST(req: Request) {
  const raw = await req.text()
  if (!validSignature(req, raw)) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })

  let event: { type?: unknown; owner_id?: unknown; phone?: unknown }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const ownerId = String(event.owner_id || '').trim()
  const phone = String(event.phone || '').trim()
  if (event.type === 'whatsapp.message.received' && ownerId && phone) {
    enqueueConversation(ownerId, phone)
  }
  return NextResponse.json({ ok: true }, { status: 202 })
}
