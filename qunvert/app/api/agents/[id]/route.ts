export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { parseAgentConfig, shouldSubmitVariantCarousel } from '@/lib/agentConfig'
import { submitVariantCarouselTemplates } from '@/lib/carouselTemplates'
import { deleteMetaAssignmentSync, syncMetaAssignment } from '@/lib/channels'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { normalizeAppLocale } from '@/lib/language'
import { publishLeadFlowForAgent } from '@/lib/leadFlowSync'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const existing = await prisma.agent.findFirst({
    where: { id: params.id, ownerId: owner.ownerId },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.prompt === 'string') data.prompt = body.prompt.slice(0, 8000)
  if (typeof body.name === 'string') data.name = body.name.slice(0, 120)
  if (typeof body.storeDomain === 'string' || body.storeDomain === null) data.storeDomain = body.storeDomain
  if (typeof body.storeName === 'string' || body.storeName === null) data.storeName = body.storeName
  if (body.productScope === 'all' || body.productScope === 'product') data.productScope = body.productScope
  if (typeof body.productId === 'string' || body.productId === null) data.productId = body.productId
  if (typeof body.productName === 'string' || body.productName === null) data.productName = body.productName
  if (typeof body.productImage === 'string' || body.productImage === null) data.productImage = body.productImage
  if (typeof body.productJson === 'string') data.productJson = body.productJson
  if (normalizeAppLocale(body.language)) data.language = normalizeAppLocale(body.language)
  if (body.policies && typeof body.policies === 'object') {
    data.policiesJson = JSON.stringify(body.policies)
    const policies = body.policies as Record<string, unknown>
    if (policies.desiredStatus === 'active' || policies.desiredStatus === 'paused') {
      data.enabled = policies.desiredStatus === 'active'
    }
  }

  const updated = await prisma.agent.update({ where: { id: existing.id }, data })
  const agent = await publishLeadFlowForAgent(owner.token, updated)
  const assignments = await prisma.agentChannelAssignment.findMany({
    where: { agentId: agent.id, ownerId: owner.ownerId },
  })
  await Promise.all(assignments.map((assignment) =>
    syncMetaAssignment(owner.ownerId, agent, assignment),
  ))
  const config = parseAgentConfig(agent.policiesJson)
  let carousel: { ok: boolean; submitted?: number; error?: string } | null = null
  if (assignments.some((assignment) => assignment.channel === 'whatsapp') && shouldSubmitVariantCarousel(config)) {
    carousel = await submitVariantCarouselTemplates(owner.token, {
      allProducts: config.allProducts,
      productIds: config.productIds,
    })
  }
  return NextResponse.json({ agent: { ...agent, assignments }, carousel })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const existing = await prisma.agent.findFirst({
    where: { id: params.id, ownerId: owner.ownerId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const whereAgent = { ownerId: owner.ownerId, agentId: existing.id }
  const assignments = await prisma.agentChannelAssignment.findMany({
    where: whereAgent,
    select: { id: true },
  })
  await Promise.all(assignments.map((assignment) =>
    deleteMetaAssignmentSync(existing.id, assignment.id),
  ))
  await prisma.$transaction([
    prisma.agentFollowUp.deleteMany({ where: whereAgent }),
    prisma.agentConversationLabel.deleteMany({ where: whereAgent }),
    prisma.agentInboundClaim.deleteMany({ where: whereAgent }),
    prisma.agentOutbound.deleteMany({ where: whereAgent }),
    prisma.agentConversation.deleteMany({ where: whereAgent }),
    prisma.agentOrder.deleteMany({ where: whereAgent }),
    prisma.agent.deleteMany({ where: { id: existing.id, ownerId: owner.ownerId } }),
  ])
  return NextResponse.json({ ok: true })
}
