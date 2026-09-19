export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fmTokenFor, requireOwner, unauthorized } from '@/lib/fm'

export async function GET(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()
  const token = await fmTokenFor(ownerId)
  if (!token) return NextResponse.json({ labelsByPhone: {} })
  const url = new URL(req.url)
  const phones = url.searchParams.get('phones') || ''
  try {
    const response = await fetch(
      `http://127.0.0.1:39014/whatsapp-ai-agents/api/conversation-labels?phones=${encodeURIComponent(phones)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      },
    )
    const data = await response.json().catch(() => ({ labelsByPhone: {} }))
    return NextResponse.json(response.ok ? data : { labelsByPhone: {} })
  } catch {
    return NextResponse.json({ labelsByPhone: {} })
  }
}
