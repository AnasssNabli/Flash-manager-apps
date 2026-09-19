export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { listStores } from '@/lib/stores'

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const stores = await listStores(owner.token)
  return NextResponse.json({ stores })
}
