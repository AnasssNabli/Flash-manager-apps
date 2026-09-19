export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { getConversationLabels } from '@/lib/labels'

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const phones = (url.searchParams.get('phones') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100)
  const rows = await getConversationLabels(owner.ownerId, phones.length ? phones : undefined)
  const labelsByPhone: Record<string, string[]> = {}
  for (const row of rows) {
    labelsByPhone[row.phone] ||= []
    if (!labelsByPhone[row.phone].includes(row.label)) labelsByPhone[row.phone].push(row.label)
  }
  return NextResponse.json({ labelsByPhone })
}
