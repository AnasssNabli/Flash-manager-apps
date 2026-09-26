export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { buildSellerAgentPrompt, draftAgentPrompt, sanitizeProductBriefs, type AgentPolicies } from '@/lib/ai'
import { COPY_CREDITS, chargeCredits } from '@/lib/credits'
import { requireOwner } from '@/lib/fm'
import type { Product } from '@/lib/products'
import { completedAnswers, parseQuestionnaire } from '@/lib/questionnaire'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const prompt = body.buildFromQuestionnaire
      ? await buildSellerAgentPrompt({
          tone: typeof body.tone === 'string' ? body.tone : 'friendly',
          storeName: typeof body.storeName === 'string' ? body.storeName : null,
          products: sanitizeProductBriefs(body.products),
          language: typeof body.language === 'string' ? body.language : null,
          entries: completedAnswers(parseQuestionnaire({
            common: body.common,
            interview: body.interview,
          })),
        })
      : await draftAgentPrompt({
          language: typeof body.language === 'string' ? body.language : 'auto',
          storeName: body.storeName || null,
          productScope: body.productScope === 'product' ? 'product' : 'all',
          product: (body.product as Product) || null,
          policies: {
            freeShipping: !!body.policies?.freeShipping,
            cashOnDelivery: !!body.policies?.cashOnDelivery,
            exchange: !!body.policies?.exchange,
            returns: !!body.policies?.returns,
          } satisfies AgentPolicies,
        })
    await chargeCredits(owner.token, COPY_CREDITS, 'wa-ai-agent-prompt')
    return NextResponse.json({ prompt })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'prompt_failed' },
      { status: 502 },
    )
  }
}
