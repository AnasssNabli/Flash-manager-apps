export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { refineAgentField } from '@/lib/aiRuntime'
import { requireOwner } from '@/lib/fm'
import { listProducts } from '@/lib/products'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const field = String(body.field || '')
  if (!['instructions', 'tone', 'forbiddenContent'].includes(field)) {
    return NextResponse.json({ error: 'invalid_field' }, { status: 400 })
  }
  const products = field === 'instructions'
    ? await listProducts(owner.token, '', 100, String(body.storeDomain || ''))
    : []
  const text = await refineAgentField({
    field: field as 'instructions' | 'tone' | 'forbiddenContent',
    mode: body.mode === 'support' ? 'support' : 'leads',
    currentText: String(body.currentText || '').slice(0, 8000),
    products,
  })
  return NextResponse.json({ text })
}
