export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { getOrCreateSettings } from '@/lib/tenants'

const LANGS = new Set(['auto', 'darija', 'fr', 'ar', 'en'])
const TONES = new Set(['helpful', 'sales', 'concise'])

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await getOrCreateSettings(owner.ownerId)

  const data: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.language === 'string' && LANGS.has(body.language)) data.language = body.language
  if (typeof body.tone === 'string' && TONES.has(body.tone)) data.tone = body.tone
  if (typeof body.instructions === 'string') data.instructions = body.instructions.slice(0, 2000)
  if (typeof body.productAware === 'boolean') data.productAware = body.productAware

  const settings = await prisma.agentSettings.update({
    where: { ownerId: owner.ownerId },
    data,
  })
  return NextResponse.json({ settings })
}
