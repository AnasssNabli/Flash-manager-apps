import { messageKindOf } from './waMedia'

export type OptimisticMsg = {
  id: string
  direction?: string | null
  body?: string | null
  type?: string | null
  timestamp: string
  media_url?: string | null
  metadata?: Record<string, unknown> | null
}

export function newOptimisticId(): string {
  return `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function isOptimisticId(id: string | null | undefined): boolean {
  return String(id || '').startsWith('pending-')
}

function textKey(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Drop a local pending bubble once the real outbound copy is in the thread.
 * Match by body for text, and by media kind + time for photos / voice.
 */
export function takeServerMatch(
  pending: OptimisticMsg,
  server: OptimisticMsg[],
  claimed: Set<string>,
): string | null {
  const pendingTime = new Date(pending.timestamp).getTime()
  if (!Number.isFinite(pendingTime)) return null
  const pendingKind = messageKindOf(pending)
  const pendingBody = textKey(pending.body)

  for (const msg of server) {
    if (!msg.id || claimed.has(msg.id) || isOptimisticId(msg.id)) continue
    if (msg.direction !== 'outbound') continue
    const serverTime = new Date(msg.timestamp).getTime()
    if (!Number.isFinite(serverTime)) continue
    if (serverTime < pendingTime - 20_000 || serverTime > pendingTime + 180_000) continue

    const serverKind = messageKindOf(msg)
    if (pendingKind === 'text' || pendingKind === 'unknown' || pendingKind === 'edit') {
      const serverBody = textKey(msg.body)
      if (!pendingBody || serverBody !== pendingBody) continue
    } else if (serverKind !== pendingKind) {
      continue
    } else if (pendingBody) {
      const serverBody = textKey(msg.body)
      if (serverBody && serverBody !== pendingBody) continue
    }
    return msg.id
  }
  return null
}
