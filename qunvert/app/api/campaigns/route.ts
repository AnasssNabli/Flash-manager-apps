export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { draftCampaign } from '@/lib/ai'
import { shapeCampaign } from '@/lib/campaigns'
import { COPY_CREDITS, chargeCredits } from '@/lib/credits'
import { requireOwner } from '@/lib/fm'
import { getOrCreateSettings } from '@/lib/tenants'

const AUDIENCES = new Set(['window24h', 'needs_reply', 'all'])
const PAGE_SIZE = 8

function parseProducts(raw: unknown): { id: string; title: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is { id?: unknown; title?: unknown } => !!p && typeof p === 'object')
    .map((p) => ({ id: String(p.id || '').trim(), title: String(p.title || '').trim() }))
    .filter((p) => p.id)
    .slice(0, 12)
}

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || String(PAGE_SIZE), 10) || PAGE_SIZE))

  const where = { ownerId: owner.ownerId }
  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.campaign.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / limit))
  return NextResponse.json({
    campaigns: rows.map(shapeCampaign),
    pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (body.generate) {
    const settings = await getOrCreateSettings(owner.ownerId)
    const message = await draftCampaign({
      language: settings.language,
      productName: String(body.productName || 'New product'),
      productPrice: body.productPrice || null,
      productDescription: body.productDescription || null,
      extra: body.extra || null,
    })
    await chargeCredits(owner.token, COPY_CREDITS, 'wa-ai-campaign-copy')
    return NextResponse.json({ message })
  }

  const message = String(body.message || '').trim()
  if (!message) return NextResponse.json({ error: 'message_required' }, { status: 400 })

  const conditionProducts = parseProducts(body.conditionProducts)
  const conditionType = body.conditionType === 'ordered' ? 'ordered' : 'chats'
  if (conditionType === 'ordered' && !conditionProducts.length) {
    return NextResponse.json({ error: 'products_required' }, { status: 400 })
  }

  let scheduledAt: Date | null = null
  let status = 'draft'
  if (body.schedule && body.scheduledAt) {
    const when = new Date(String(body.scheduledAt))
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 30_000) {
      return NextResponse.json({ error: 'invalid_schedule' }, { status: 400 })
    }
    scheduledAt = when
    status = 'scheduled'
  }

  const campaign = await prisma.campaign.create({
    data: {
      ownerId: owner.ownerId,
      name: String(body.name || body.productName || 'Campaign').slice(0, 120),
      productId: body.productId || null,
      productName: body.productName || null,
      productImage: body.productImage || null,
      productPrice: body.productPrice || null,
      message: message.slice(0, 4000),
      audience: AUDIENCES.has(body.audience) ? body.audience : 'window24h',
      conditionType,
      conditionJson: conditionType === 'ordered'
        ? JSON.stringify({
            productIds: conditionProducts.map((p) => p.id),
            products: conditionProducts,
          })
        : null,
      scheduledAt,
      status,
    },
  })
  return NextResponse.json({ campaign: shapeCampaign(campaign) })
}
