import { prisma } from './db'
import { processCampaigns } from './campaigns'
import { processFollowUps } from './followups'
import { processOwnerReplies } from './reply'

let timer: ReturnType<typeof setInterval> | null = null
let busy = false

async function tickAll() {
  if (busy) return
  busy = true
  try {
    const tenants = await prisma.tenant.findMany({
      where: { grantToken: { not: null } },
      select: { ownerId: true, grantToken: true },
    })
    for (const tenant of tenants) {
      if (!tenant.grantToken) continue
      try {
        await processOwnerReplies(tenant.ownerId, tenant.grantToken)
        await processFollowUps(tenant.ownerId, tenant.grantToken)
        await processCampaigns(tenant.ownerId, tenant.grantToken)
      } catch (err) {
        console.error('[wa-ai] tick owner failed', tenant.ownerId, err)
      }
    }
  } catch (err) {
    console.error('[wa-ai] tick failed', err)
  } finally {
    busy = false
  }
}

export function startWorker() {
  if (timer) return
  const ms = Number(process.env.TICK_MS || 20000)
  timer = setInterval(() => {
    void tickAll()
  }, Math.max(8000, ms))
  void tickAll()
  console.log(`[wa-ai] worker every ${Math.max(8000, ms)}ms`)
}
