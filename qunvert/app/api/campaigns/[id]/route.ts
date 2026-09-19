export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { shapeCampaign } from '@/lib/campaigns'
import { requireOwner } from '@/lib/fm'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '15', 10) || 15))

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, ownerId: owner.ownerId },
  })
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const where = { campaignId: campaign.id }
  const [sends, total] = await Promise.all([
    prisma.campaignSend.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.campaignSend.count({ where }),
  ])

  return NextResponse.json({
    campaign: shapeCampaign(campaign),
    sends,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  })
}
