export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { buildMetaAuthUrl, metaConfigured, type MetaProvider } from '@/lib/meta'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const provider: MetaProvider = body.provider === 'facebook' ? 'facebook' : 'instagram'
  if (!metaConfigured(provider)) {
    return NextResponse.json({ error: 'connection_unavailable' }, { status: 503 })
  }
  return NextResponse.json({ url: buildMetaAuthUrl(owner.ownerId, provider) })
}
