import { prisma } from './db'
import { listBuyers, phoneKey } from './orders'
import { inCustomerWindow, listConvos, sendText, type Convo } from './wa'

const BATCH = 12

type Condition = {
  productIds?: string[]
  products?: { id: string; title: string }[]
}

function parseCondition(raw: string | null | undefined): Condition {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Condition
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function shape(c: {
  sent: number
  converted: number
  [k: string]: unknown
}) {
  const sent = Number(c.sent || 0)
  const converted = Number(c.converted || 0)
  return {
    ...c,
    conversionRate: sent > 0 ? Math.round((converted / sent) * 1000) / 10 : 0,
  }
}

export function shapeCampaign<T extends { sent: number; converted: number }>(c: T) {
  return shape(c)
}

export async function queueAudience(
  ownerId: string,
  token: string,
  campaign: {
    id: string
    audience: string
    conditionType: string
    conditionJson: string | null
  },
) {
  const convos = await listConvos(token, campaign.audience === 'needs_reply' ? 'needs_reply' : 'all', 200)
  let picked: Convo[] = convos

  if (campaign.conditionType === 'ordered') {
    const ids = parseCondition(campaign.conditionJson).productIds || []
    const buyers = ids.length ? await listBuyers(token, { productIds: ids }) : []
    const keys = new Set(buyers.map(phoneKey).filter(Boolean))
    picked = convos.filter((c) => keys.has(phoneKey(c.phone)))
  }

  if (campaign.audience === 'window24h' || campaign.audience === 'needs_reply') {
    picked = picked.filter((c) => inCustomerWindow(c.lastInboundAt))
  }

  if (!picked.length) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'done', total: 0, startedAt: new Date() },
    })
    return 0
  }

  await prisma.campaignSend.createMany({
    data: picked.map((c) => ({
      campaignId: campaign.id,
      ownerId,
      phone: c.phone,
      status: 'queued',
    })),
    skipDuplicates: true,
  })
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'running', total: picked.length, startedAt: new Date() },
  })
  return picked.length
}

export async function startDueCampaigns(ownerId: string, token: string): Promise<number> {
  const due = await prisma.campaign.findMany({
    where: {
      ownerId,
      status: 'scheduled',
      scheduledAt: { lte: new Date() },
    },
    take: 5,
  })
  let n = 0
  for (const campaign of due) {
    n += await queueAudience(ownerId, token, campaign)
  }
  return n
}

export async function refreshConversions(ownerId: string, token: string): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId, status: { in: ['running', 'done'] }, sent: { gt: 0 } },
    orderBy: { updatedAt: 'desc' },
    take: 15,
  })
  await Promise.all(campaigns.map(async (campaign) => {
    const sends = await prisma.campaignSend.findMany({
      where: { campaignId: campaign.id, status: 'sent' },
      select: { phone: true },
      take: 400,
    })
    if (!sends.length) return
    const after = campaign.startedAt || campaign.createdAt
    const productIds = campaign.productId ? [campaign.productId] : []
    const buyers = await listBuyers(token, {
      phones: sends.map((s) => s.phone),
      after,
      productIds,
    })
    const keys = new Set(sends.map((s) => phoneKey(s.phone)).filter(Boolean))
    const converted = buyers.filter((p) => keys.has(phoneKey(p))).length
    if (converted !== campaign.converted) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { converted },
      })
    }
  }))
}

export async function processCampaigns(ownerId: string, token: string): Promise<number> {
  await startDueCampaigns(ownerId, token)
  const running = await prisma.campaign.findMany({
    where: { ownerId, status: 'running' },
    orderBy: { updatedAt: 'asc' },
    take: 2,
  })
  let sent = 0

  for (const campaign of running) {
    const queued = await prisma.campaignSend.findMany({
      where: { campaignId: campaign.id, status: 'queued' },
      take: BATCH,
    })
    if (!queued.length) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'done' },
      })
      continue
    }

    for (const row of queued) {
      const result = await sendText(token, row.phone, campaign.message)
      await prisma.campaignSend.update({
        where: { id: row.id },
        data: {
          status: result.ok ? 'sent' : 'failed',
          error: result.ok ? null : (result.error || 'send_failed').slice(0, 400),
        },
      })
      if (result.ok) sent += 1
    }

    const [sentCount, failedCount, skippedCount, left] = await Promise.all([
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: 'sent' } }),
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: 'failed' } }),
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: 'skipped' } }),
      prisma.campaignSend.count({ where: { campaignId: campaign.id, status: 'queued' } }),
    ])
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        status: left === 0 ? 'done' : 'running',
      },
    })
  }

  return sent
}
