export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { normalizeAppLocale } from '@/lib/language'
import { publishLeadFlowForAgent } from '@/lib/leadFlowSync'

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const agents = await prisma.agent.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { createdAt: 'desc' },
    include: { assignments: true },
  })
  return NextResponse.json({ agents })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const prompt = String(body.prompt || '').trim()
  if (!prompt) return NextResponse.json({ error: 'prompt_required' }, { status: 400 })

  const productScope = body.productScope === 'product' ? 'product' : 'all'
  const name = String(
    body.name ||
      (productScope === 'product' && body.productName ? body.productName : 'All products'),
  ).slice(0, 120)

  const wantsActive = body.policies?.desiredStatus === 'active'
  const enabled = wantsActive

  const policies = body.policies && typeof body.policies === 'object' ? body.policies : {}
  const created = await prisma.agent.create({
    data: {
      ownerId: owner.ownerId,
      name,
      storeDomain: body.storeDomain || null,
      storeName: body.storeName || null,
      productScope,
      productId: body.productId || null,
      productName: body.productName || null,
      productImage: body.productImage || null,
      productJson: body.productJson || null,
      policiesJson: JSON.stringify(policies),
      prompt: prompt.slice(0, 8000),
      enabled,
      language: normalizeAppLocale(body.language) || 'auto',
    },
  })
  await publishLeadFlowForAgent(owner.token, created)
  const agent = await prisma.agent.findUnique({
    where: { id: created.id },
    include: { assignments: true },
  })
  return NextResponse.json({ agent, carousel: null })
}
