export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { fetchMetaPosts } from '@/lib/meta'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const account = await prisma.metaAccount.findFirst({
    where: {
      id: String(body.accountId || ''),
      ownerId: owner.ownerId,
      status: 'connected',
    },
  })
  if (!account || (account.provider !== 'instagram' && account.provider !== 'facebook')) {
    return NextResponse.json({ error: 'account_not_available' }, { status: 404 })
  }

  try {
    const posts = await fetchMetaPosts({
      provider: account.provider,
      externalId: account.externalId,
      accessToken: account.accessToken,
    })
    return NextResponse.json({ posts })
  } catch (error) {
    console.error('[meta-posts]', (error as Error).message)
    return NextResponse.json({ error: 'posts_unavailable', posts: [] }, { status: 502 })
  }
}
