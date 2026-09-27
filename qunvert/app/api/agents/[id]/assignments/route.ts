export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { parseAgentConfig, shouldSubmitVariantCarousel } from '@/lib/agentConfig'
import { submitVariantCarouselTemplates } from '@/lib/carouselTemplates'
import {
  publicAssignment,
  syncMetaAssignment,
  type Channel,
} from '@/lib/channels'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { waStatus } from '@/lib/wa'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channel = String(body.channel || '') as Channel
  if (!['whatsapp', 'instagram', 'facebook'].includes(channel)) {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 })
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.id, ownerId: owner.ownerId },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let endpointId = String(body.endpointId || '').trim()
  let displayName = ''
  let details: Record<string, unknown> = {}

  if (channel === 'whatsapp') {
    const status = await waStatus(owner.token)
    const phone = String(status.phone?.displayPhone || '').trim()
    const availableId = String(
      status.phoneNumberId || status.phone?.phoneNumberId || status.phone?.id || phone.replace(/\D/g, '') || '',
    ).trim()
    if (!status.connected || status.tokenExpired || !availableId || endpointId !== availableId) {
      return NextResponse.json({ error: 'whatsapp_not_available' }, { status: 409 })
    }
    endpointId = availableId
    displayName = status.phone?.verifiedName || 'WhatsApp Business'
    details = { phone, verifiedName: status.phone?.verifiedName || '' }
  } else {
    const account = await prisma.metaAccount.findFirst({
      where: {
        id: endpointId,
        ownerId: owner.ownerId,
        provider: channel,
        status: 'connected',
      },
    })
    if (!account) return NextResponse.json({ error: 'account_not_available' }, { status: 409 })
    displayName = channel === 'instagram' && account.username
      ? `@${account.username}`
      : account.displayName || (channel === 'instagram' ? 'Instagram account' : 'Facebook Page')
    details = {
      username: account.username,
      externalId: account.externalId,
      triggerType: body.triggerType === 'specific_post' ? 'specific_post' : 'all_posts',
      selectedPosts: Array.isArray(body.selectedPosts)
        ? body.selectedPosts.slice(0, 40)
          .filter((post: unknown): post is Record<string, unknown> =>
            Boolean(post && typeof post === 'object' && !Array.isArray(post)),
          )
          .map((post: Record<string, unknown>) => ({
            id: String(post.id || '').slice(0, 200),
            caption: String(post.caption || '').slice(0, 300),
            imageUrl: post.imageUrl ? String(post.imageUrl).slice(0, 2000) : null,
            timestamp: post.timestamp ? String(post.timestamp).slice(0, 100) : '',
          })).filter((post: { id: string }) => post.id)
        : [],
    }
    if (details.triggerType === 'specific_post' && !(details.selectedPosts as unknown[]).length) {
      return NextResponse.json({ error: 'posts_required' }, { status: 400 })
    }
  }

  const endpointOwner = await prisma.agentChannelAssignment.findFirst({
    where: {
      ownerId: owner.ownerId,
      channel,
      endpointId,
      NOT: { agentId: agent.id },
    },
  })
  if (endpointOwner) {
    return NextResponse.json({ error: 'endpoint_already_assigned' }, { status: 409 })
  }

  const current = await prisma.agentChannelAssignment.findFirst({
    where: { ownerId: owner.ownerId, channel, endpointId },
  })
  const assignment = current
    ? await prisma.agentChannelAssignment.update({
        where: { id: current.id },
        data: { displayName, detailsJson: JSON.stringify(details) },
      })
    : await prisma.agentChannelAssignment.create({
        data: {
          ownerId: owner.ownerId,
          agentId: agent.id,
          channel,
          endpointId,
          displayName,
          detailsJson: JSON.stringify(details),
        },
      })
  await syncMetaAssignment(owner.ownerId, agent, assignment)
  if (channel === 'whatsapp') {
    const config = parseAgentConfig(agent.policiesJson)
    if (shouldSubmitVariantCarousel(config)) {
      await submitVariantCarouselTemplates(owner.token, {
        allProducts: config.allProducts,
        productIds: config.productIds,
      })
    }
  }

  return NextResponse.json({ assignment: publicAssignment(assignment) })
}
