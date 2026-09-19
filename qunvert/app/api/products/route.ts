export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/fm'
import { listProducts } from '@/lib/products'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const products = await listProducts(
    owner.token,
    url.searchParams.get('search') || '',
    40,
    url.searchParams.get('shop') || '',
  )
  return NextResponse.json({ products })
}
