export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { listMetaAccounts } from '@/lib/channels'
import { requireOwner } from '@/lib/fm'
import { metaConfigured } from '@/lib/meta'
import { waStatus } from '@/lib/wa'

function whatsappEndpoint(status: Awaited<ReturnType<typeof waStatus>>) {
  if (!status.connected || status.tokenExpired) return null
  const displayPhone = String(status.phone?.displayPhone || '').trim()
  const endpointId = String(
    status.phoneNumberId || status.phone?.phoneNumberId || status.phone?.id || displayPhone.replace(/\D/g, '') || '',
  ).trim()
  if (!endpointId) return null
  return {
    id: endpointId,
    displayName: status.phone?.verifiedName || 'WhatsApp Business',
    subtitle: displayPhone || 'Connected number',
    details: { phone: displayPhone, verifiedName: status.phone?.verifiedName || '' },
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [status, accounts] = await Promise.all([
    waStatus(owner.token),
    listMetaAccounts(owner.ownerId),
  ])

  return NextResponse.json({
    whatsapp: whatsappEndpoint(status),
    accounts,
    connectAvailable: {
      instagram: metaConfigured('instagram'),
      facebook: metaConfigured('facebook'),
    },
  })
}
