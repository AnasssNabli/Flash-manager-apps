export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { rememberGrantIfMissing } from '@/lib/tenants'
import { listConvos, waStatus } from '@/lib/wa'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await rememberGrantIfMissing(owner.ownerId, owner.token)

  const [status, convos, replies, agents] = await Promise.all([
    waStatus(owner.token),
    listConvos(owner.token, 'needs_reply', 80).catch(() => []),
    prisma.replyLog.findMany({
      where: { ownerId: owner.ownerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.agent.findMany({
      where: { ownerId: owner.ownerId },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return NextResponse.json({
    ownerId: owner.ownerId,
    status,
    waiting: convos.length,
    replies,
    agents,
    backgroundReady: true,
  })
}
