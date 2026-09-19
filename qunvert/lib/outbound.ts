import type { AgentOutbound } from '@prisma/client'
import { stableHash } from './hash'
import { prisma } from './db'
import { messageTime, type SendResult, type ThreadMessage } from './wa'

export function outboundHash(kind: string, body: string): string {
  return stableHash(`${kind.toLowerCase()}\n${String(body || '').trim()}`)
}

export async function planOutbound(opts: {
  ownerId: string
  agentId: string
  phone: string
  kind: string
  body: string
  source: string
}) {
  return prisma.agentOutbound.create({
    data: {
      ...opts,
      bodyHash: outboundHash(opts.kind, opts.body),
      status: 'planned',
    },
  })
}

export async function finishOutbound(id: string, result: SendResult) {
  await prisma.agentOutbound.update({
    where: { id },
    data: {
      status: result.ok ? 'sent' : 'failed',
      sentAt: result.ok ? new Date() : null,
      gatewayMessageId: result.messageId || null,
    },
  })
}

export function isKnownAgentOutbound(message: ThreadMessage, rows: AgentOutbound[]): boolean {
  const messageId = String(message.wa_message_id || message.id || '')
  if (messageId && rows.some((row) => row.gatewayMessageId === messageId)) return true
  const kind = String(message.type || 'text').toLowerCase()
  const body = String(message.body || '').trim()
  const hash = outboundHash(kind, body)
  const timestamp = messageTime(message)
  return rows.some((row) => {
    const rowTime = (row.sentAt || row.createdAt).getTime()
    if (Math.abs(timestamp - rowTime) > 2 * 60 * 1000) return false
    if (body) return row.bodyHash === hash || String(row.body || '').trim() === body
    return row.kind === kind
  })
}

export async function recentOutboundLedger(ownerId: string, phone: string) {
  return prisma.agentOutbound.findMany({
    where: {
      ownerId,
      phone,
      status: 'sent',
      sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { sentAt: 'desc' },
    take: 200,
  })
}
