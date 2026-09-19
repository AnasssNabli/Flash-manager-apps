export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { draftAgentPrompt, type AgentPolicies } from '@/lib/ai'
import { COPY_CREDITS, chargeCredits } from '@/lib/credits'
import { requireOwner } from '@/lib/fm'
import type { Product } from '@/lib/products'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const policies: AgentPolicies = {
    freeShipping: !!body.policies?.freeShipping,
    cashOnDelivery: !!body.policies?.cashOnDelivery,
    exchange: !!body.policies?.exchange,
    returns: !!body.policies?.returns,
  }

  const prompt = await draftAgentPrompt({
    language: typeof body.language === 'string' ? body.language : 'auto',
    storeName: body.storeName || null,
    productScope: body.productScope === 'product' ? 'product' : 'all',
    product: (body.product as Product) || null,
    policies,
  })
  await chargeCredits(owner.token, COPY_CREDITS, 'wa-ai-agent-prompt')
  return NextResponse.json({ prompt })
}
