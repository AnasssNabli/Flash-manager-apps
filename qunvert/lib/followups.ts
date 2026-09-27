import { hitAiReplyLimit, remainingResponseBudget } from './gates'
import { parseAgentConfig } from './agentConfig'
import { generateFollowUp, type HistoryItem } from './aiRuntime'
import { chargeCredits } from './credits'
import { prisma } from './db'
import { applyConversationLabel } from './labels'
import { sendOutputWithMedia } from './media'
import { finishOutbound, planOutbound } from './outbound'
import { collapseRepeatedPhrases } from './replyQuality'
import { getThread, inCustomerWindow, lastInbound, messageBody, messageId, messageTime } from './wa'

const MAX_FOLLOWUPS_PER_TICK = 6
export const FOLLOW_UP_WINDOW_MS = 23 * 60 * 60 * 1000
const FOLLOW_UP_SEND_BUFFER_MS = 60 * 1000

export function inFollowUpWindow(inboundAt: string | Date | number, now = Date.now()): boolean {
  const timestamp = new Date(inboundAt).getTime()
  return Number.isFinite(timestamp) && now - timestamp < FOLLOW_UP_WINDOW_MS
}

/** Keep one minute for worker/gateway latency while enforcing the 23-hour ceiling. */
export function clampFollowUpDueAt(requestedAt: Date, sourceInboundAt: Date): Date {
  const latestSafeSend = sourceInboundAt.getTime() + FOLLOW_UP_WINDOW_MS - FOLLOW_UP_SEND_BUFFER_MS
  return new Date(Math.min(requestedAt.getTime(), latestSafeSend))
}

export async function processFollowUps(ownerId: string, token: string): Promise<number> {
  const jobs = await prisma.agentFollowUp.findMany({
    where: {
      ownerId,
      status: 'scheduled',
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: 'asc' },
    take: MAX_FOLLOWUPS_PER_TICK,
  })
  let sent = 0

  for (const job of jobs) {
    const claimed = await prisma.agentFollowUp.updateMany({
      where: { id: job.id, status: 'scheduled' },
      data: { status: 'processing' },
    })
    if (!claimed.count) continue

    try {
      const agent = await prisma.agent.findFirst({
        where: {
          id: job.agentId,
          ownerId,
          enabled: true,
          assignments: { some: { channel: 'whatsapp' } },
        },
      })
      if (!agent) throw new Error('agent_inactive')
      const config = parseAgentConfig(agent.policiesJson)
      if (!config.followUp.enabled) throw new Error('followup_disabled')

      const conversation = await prisma.agentConversation.findUnique({
        where: { agentId_phone: { agentId: agent.id, phone: job.phone } },
      })
      if (!conversation || conversation.state !== 'ai_active' || conversation.orderConfirmedAt) {
        throw new Error('conversation_not_eligible')
      }
      if (hitAiReplyLimit(config.maxResponses, conversation.aiReplyCount)) {
        await prisma.agentConversation.update({
          where: { id: conversation.id },
          data: { state: 'stopped', stoppedAt: new Date() },
        }).catch(() => {})
        throw new Error('max_responses')
      }

      const thread = await getThread(token, job.phone)
      const inbound = lastInbound(thread)
      if (!inbound || messageId(inbound) !== job.sourceInboundId) throw new Error('customer_replied')
      const inboundTime = messageTime(inbound) || 0
      const inboundAt = new Date(inboundTime).toISOString()
      if (!inCustomerWindow(inboundAt)) throw new Error('outside_customer_window')
      if (!inFollowUpWindow(inboundTime)) throw new Error('outside_followup_window')

      const history: HistoryItem[] = [...thread]
        .sort((a, b) => messageTime(a) - messageTime(b))
        .slice(-50)
        .map((message) => ({
          role: message.direction === 'inbound' ? 'user' as const : 'assistant' as const,
          text: messageBody(message),
          type: message.type,
        }))
      const output = collapseRepeatedPhrases(await generateFollowUp({
        ownerId,
        businessName: agent.name,
        instructions: config.followUp.instructions,
        history,
      }))
      if (!output) throw new Error('empty_followup')
      await chargeCredits(token, 1, `wa-ai-followup:${job.phone}`, `followup:${job.id}`)

      const remainingBudget = remainingResponseBudget(config.maxResponses, conversation.aiReplyCount)
      const delivery = await sendOutputWithMedia({
        token,
        to: job.phone,
        output,
        remainingBudget,
        beforeSend: async (item) => {
          const row = await planOutbound({
            ownerId,
            agentId: agent.id,
            phone: job.phone,
            kind: item.kind,
            body: item.body,
            source: 'followup',
          })
          return row.id
        },
        afterSend: finishOutbound,
      })

      await prisma.$transaction([
        prisma.agentFollowUp.update({
          where: { id: job.id },
          data: { status: 'sent', sentAt: new Date() },
        }),
        prisma.agentConversation.update({
          where: { id: conversation.id },
          data: { aiReplyCount: { increment: delivery.sent } },
        }),
      ])
      await applyConversationLabel({
        ownerId,
        agentId: agent.id,
        phone: job.phone,
        label: config.labels.followUp,
        slot: 'follow_up',
        token,
      })
      sent += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'followup_failed'
      const terminal = [
        'agent_inactive',
        'followup_disabled',
        'conversation_not_eligible',
        'max_responses',
        'customer_replied',
        'outside_customer_window',
        'outside_followup_window',
      ].includes(message)
      await prisma.agentFollowUp.update({
        where: { id: job.id },
        data: {
          status: terminal ? 'cancelled' : 'failed',
          cancelledAt: terminal ? new Date() : null,
          error: message.slice(0, 500),
        },
      }).catch(() => {})
    }
  }
  return sent
}
