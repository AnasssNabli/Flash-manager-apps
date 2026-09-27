import { prisma } from './db'
import { processCampaigns } from './campaigns'
import { processFollowUps } from './followups'
import { processOwnerReplies } from './reply'
import { receivedEventWithin } from './replyQueue'

const OWNER_CONCURRENCY = 4
/** FlashManager only pushes events once it forwards WhatsApp webhooks; until then the sweep is the trigger. */
const SWEEP_WITHOUT_EVENTS_MS = 20_000
const SWEEP_WITH_EVENTS_MS = 5 * 60_000
const EVENTS_HEALTHY_MS = 24 * 60 * 60_000
const CAMPAIGN_PACE_MS = 20_000
const BACKLOG_MS = 5_000
const MAX_IDLE_MS = 30_000

let started = false

function loop(name: string, run: () => Promise<number>) {
  const tick = async () => {
    let delay = MAX_IDLE_MS
    try {
      delay = await run()
    } catch (error) {
      console.error(`[wa-ai] ${name} failed`, error)
    }
    setTimeout(tick, delay)
  }
  void tick()
}

/** Runs the job for each owner that still has a grant token; returns how many ran. */
async function forEachOwner(ownerIds: string[], run: (ownerId: string, token: string) => Promise<unknown>): Promise<number> {
  if (!ownerIds.length) return 0
  const tenants = await prisma.tenant.findMany({
    where: { ownerId: { in: ownerIds }, grantToken: { not: null } },
    select: { ownerId: true, grantToken: true },
  })
  let next = 0
  const lane = async () => {
    while (next < tenants.length) {
      const tenant = tenants[next++]
      try {
        await run(tenant.ownerId, tenant.grantToken!)
      } catch (error) {
        console.error('[wa-ai] owner job failed', tenant.ownerId, error)
      }
    }
  }
  await Promise.all(Array.from({ length: OWNER_CONCURRENCY }, lane))
  return tenants.length
}

async function sweepReplies(): Promise<number> {
  const agents = await prisma.agent.findMany({
    where: { enabled: true, assignments: { some: { channel: 'whatsapp' } } },
    select: { ownerId: true },
    distinct: ['ownerId'],
  })
  await forEachOwner(agents.map((agent) => agent.ownerId), processOwnerReplies)
  return receivedEventWithin(EVENTS_HEALTHY_MS) ? SWEEP_WITH_EVENTS_MS : SWEEP_WITHOUT_EVENTS_MS
}

function untilDue(at: Date | null | undefined): number {
  if (!at) return MAX_IDLE_MS
  return Math.min(MAX_IDLE_MS, Math.max(1_000, at.getTime() - Date.now()))
}

async function runFollowUps(): Promise<number> {
  const now = new Date()
  const due = await prisma.agentFollowUp.findMany({
    where: { status: 'scheduled', dueAt: { lte: now } },
    select: { ownerId: true },
    distinct: ['ownerId'],
  })
  if (await forEachOwner(due.map((row) => row.ownerId), processFollowUps)) return BACKLOG_MS
  const next = await prisma.agentFollowUp.findFirst({
    where: { status: 'scheduled', dueAt: { gt: now } },
    orderBy: { dueAt: 'asc' },
    select: { dueAt: true },
  })
  return untilDue(next?.dueAt)
}

async function runCampaigns(): Promise<number> {
  const now = new Date()
  const active = await prisma.campaign.findMany({
    where: { OR: [{ status: 'running' }, { status: 'scheduled', scheduledAt: { lte: now } }] },
    select: { ownerId: true },
    distinct: ['ownerId'],
  })
  if (await forEachOwner(active.map((row) => row.ownerId), processCampaigns)) return CAMPAIGN_PACE_MS
  const next = await prisma.campaign.findFirst({
    where: { status: 'scheduled', scheduledAt: { gt: now } },
    orderBy: { scheduledAt: 'asc' },
    select: { scheduledAt: true },
  })
  return untilDue(next?.scheduledAt)
}

export function startWorker() {
  if (started) return
  started = true
  loop('reply sweep', sweepReplies)
  loop('follow-ups', runFollowUps)
  loop('campaigns', runCampaigns)
}
