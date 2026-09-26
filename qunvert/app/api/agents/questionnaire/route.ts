export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { nextSellerInterviewQuestion, sanitizeProductBriefs } from '@/lib/ai'
import { requireOwner } from '@/lib/fm'
import { parseQuestionnaire } from '@/lib/questionnaire'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const state = parseQuestionnaire({
    common: body.common,
    interview: body.interview,
  })

  try {
    const result = await nextSellerInterviewQuestion({
      storeName: typeof body.storeName === 'string' ? body.storeName : null,
      products: sanitizeProductBriefs(body.products),
      language: typeof body.language === 'string' ? body.language : null,
      common: state.common.filter((item) => item.question || item.answer || item.media.length),
      interview: state.interview.filter((item) => item.question),
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'questionnaire_failed' },
      { status: 502 },
    )
  }
}
