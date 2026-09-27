import { prisma } from './db'
import { processConversationReply } from './reply'

/** Rapid-batch window (5s) plus margin, so bursts of messages get one reply. */
const SETTLE_MS = 6_000
const MAX_ACTIVE = 8

const settling = new Map<string, ReturnType<typeof setTimeout>>()
const running = new Set<string>()
const rerun = new Set<string>()
const ready: string[] = []
let lastEventAt = 0

export function receivedEventWithin(ms: number): boolean {
  return Date.now() - lastEventAt < ms
}

/** Debounced per conversation; one conversation never runs twice at once. */
export function enqueueConversation(ownerId: string, phone: string) {
  lastEventAt = Date.now()
  settle(`${ownerId}\n${phone}`)
}

function settle(key: string) {
  clearTimeout(settling.get(key))
  settling.set(key, setTimeout(() => {
    settling.delete(key)
    if (running.has(key)) rerun.add(key)
    else if (!ready.includes(key)) ready.push(key)
    drain()
  }, SETTLE_MS))
}

function drain() {
  while (running.size < MAX_ACTIVE && ready.length) void run(ready.shift()!)
}

async function run(key: string) {
  running.add(key)
  const [ownerId, phone] = key.split('\n')
  try {
    const tenant = await prisma.tenant.findUnique({ where: { ownerId }, select: { grantToken: true } })
    if (tenant?.grantToken) {
      const outcome = await processConversationReply(ownerId, tenant.grantToken, phone)
      if (outcome === 'wait') rerun.add(key)
    }
  } catch (error) {
    console.error('[wa-ai] conversation reply failed', ownerId, error)
  } finally {
    running.delete(key)
    if (rerun.delete(key)) settle(key)
    drain()
  }
}
