export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { listKnownWhatsAppLabels } from '@/lib/labels'
import { listWhatsAppLabels, mergeWhatsAppLabels, waStatus } from '@/lib/wa'

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const status = await waStatus(owner.token)
  const connected = status.connected === true && !status.tokenExpired
  if (!connected) {
    return NextResponse.json({ connected: false, labels: [] })
  }

  const [live, known] = await Promise.all([
    listWhatsAppLabels(owner.token, owner.ownerId).catch(() => []),
    listKnownWhatsAppLabels(owner.ownerId).catch(() => []),
  ])
  const labels = mergeWhatsAppLabels(live, known)
  return NextResponse.json({
    connected: true,
    live: live.length > 0,
    labels,
  })
}
