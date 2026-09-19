export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { waStatus } from '@/lib/wa'

async function whatsappReady(token: string) {
  const status = await waStatus(token)
  return status.connected === true && !status.tokenExpired
}

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const agents = await prisma.agent.findMany({
    where: { ownerId: owner.ownerId },
    orderBy: { createdAt: 'desc' },
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
  const enabled = wantsActive && await whatsappReady(owner.token)

  const agent = await prisma.agent.create({
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
      policiesJson: body.policiesJson ? JSON.stringify(body.policiesJson) : JSON.stringify(body.policies || {}),
      prompt: prompt.slice(0, 8000),
      enabled,
      language: typeof body.language === 'string' ? body.language : 'auto',
    },
  })
  return NextResponse.json({ agent })
}
