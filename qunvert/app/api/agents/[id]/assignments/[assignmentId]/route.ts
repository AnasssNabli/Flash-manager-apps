export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { deleteMetaAssignmentSync } from '@/lib/channels'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; assignmentId: string } },
) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const assignment = await prisma.agentChannelAssignment.findFirst({
    where: {
      id: params.assignmentId,
      agentId: params.id,
      ownerId: owner.ownerId,
    },
  })
  if (!assignment) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await prisma.agentChannelAssignment.delete({ where: { id: assignment.id } })
  await deleteMetaAssignmentSync(params.id, assignment.id)
  return NextResponse.json({ ok: true })
}
