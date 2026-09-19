export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { processCampaigns, queueAudience, shapeCampaign } from '@/lib/campaigns'
import { requireOwner } from '@/lib/fm'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, ownerId: owner.ownerId },
  })
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!campaign.message.trim()) return NextResponse.json({ error: 'message_required' }, { status: 400 })
  if (campaign.status === 'running' || campaign.status === 'done') {
    return NextResponse.json({ campaign: shapeCampaign(campaign), queued: 0 })
  }

  const total = await queueAudience(owner.ownerId, owner.token, campaign)
  await processCampaigns(owner.ownerId, owner.token)
  const fresh = await prisma.campaign.findUnique({ where: { id: campaign.id } })
  return NextResponse.json({ campaign: fresh ? shapeCampaign(fresh) : fresh, queued: total })
}
