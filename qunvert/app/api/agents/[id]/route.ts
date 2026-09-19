export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { waStatus } from '@/lib/wa'

async function whatsappReady(token: string) {
  const status = await waStatus(token)
  return status.connected === true && !status.tokenExpired
}

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
  if (body.policies && typeof body.policies === 'object') {
    data.policiesJson = JSON.stringify(body.policies)
    const policies = body.policies as Record<string, unknown>
    if (policies.desiredStatus === 'active' || policies.desiredStatus === 'paused') {
      if (policies.desiredStatus === 'active' && !await whatsappReady(owner.token)) {
        return NextResponse.json({ error: 'whatsapp_disconnected' }, { status: 409 })
      }
      data.enabled = policies.desiredStatus === 'active'
    }
  }

  const agent = await prisma.agent.update({ where: { id: existing.id }, data })
  return NextResponse.json({ agent })
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
