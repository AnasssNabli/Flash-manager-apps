export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { processCampaigns } from '@/lib/campaigns'
import { requireOwner } from '@/lib/fm'
import { processFollowUps } from '@/lib/followups'
import { processOwnerReplies } from '@/lib/reply'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const replies = await processOwnerReplies(owner.ownerId, owner.token)
  const followups = await processFollowUps(owner.ownerId, owner.token)
  const campaigns = await processCampaigns(owner.ownerId, owner.token)
  return NextResponse.json({ replies, followups, campaigns })
}
