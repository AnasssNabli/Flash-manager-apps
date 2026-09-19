import type { Agent } from '@prisma/client'
import type { AgentConfiguration } from './agentConfig'
import { fillConfirmationTemplate, type ToolAction } from './aiRuntime'
import { prisma } from './db'
import { applyConversationLabel } from './labels'
import { createAgentOrder, orderFingerprint, type AgentOrderData } from './orders'
import { finishOutbound, planOutbound } from './outbound'
import { collapseRepeatedPhrases, isDoNotAnswerTool } from './replyQuality'
import { sendText } from './wa'

export type ActionResult = {
  reply: string
  stateChanged: boolean
  skipSend?: boolean
  skipReason?: string
}

async function sendSystemText(opts: {
  ownerId: string
  agentId: string
  token: string
  to: string
  text: string
  source: string
}) {
  if (!opts.to || !opts.text.trim()) return
  const ledger = await planOutbound({
    ownerId: opts.ownerId,
    agentId: opts.agentId,
    phone: opts.to,
    kind: 'text',
    body: opts.text,
    source: opts.source,
  })
  const result = await sendText(opts.token, opts.to, opts.text)
  await finishOutbound(ledger.id, result)
  if (!result.ok) throw new Error(result.error || 'notification_send_failed')
}

export async function executeAgentAction(opts: {
  ownerId: string
  token: string
  agent: Agent
  config: AgentConfiguration
  phone: string
  action: ToolAction | null
  fallbackReply: string
}): Promise<ActionResult> {
  const action = opts.action
  if (!action) return { reply: collapseRepeatedPhrases(opts.fallbackReply), stateChanged: false }

  if (isDoNotAnswerTool(action.name)) {
    const reason = String(action.arguments.reason || 'off_topic')
    const explanation = String(action.arguments.explanation || '').trim()
    return {
      reply: '',
      stateChanged: false,
      skipSend: true,
      skipReason: `donotanswer:${reason}${explanation ? `:${explanation}` : ''}`.slice(0, 500),
    }
  }

  const response = collapseRepeatedPhrases(String(action.arguments.response || opts.fallbackReply || '').trim())

  if (action.name === 'order_summary_sent') {
    const pending = (action.arguments.pending_data || {}) as Record<string, unknown>
    await prisma.agentConversation.upsert({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      create: {
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        phone: opts.phone,
        pendingOrderJson: JSON.stringify(pending),
      },
      update: { pendingOrderJson: JSON.stringify(pending) },
    })
    await applyConversationLabel({
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      label: opts.config.labels.orderSummary,
      slot: 'order_summary',
      token: opts.token,
    })
    return { reply: response, stateChanged: true }
  }

  if (action.name === 'request_human_agent') {
    const current = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
    })
    if (current?.state === 'human_requested' || current?.state === 'human_active' || current?.state === 'stopped') {
      return {
        reply: '',
        stateChanged: false,
        skipSend: true,
        skipReason: 'human_already_requested',
      }
    }
    const requestedAt = new Date()
    if (!current) {
      try {
        await prisma.agentConversation.create({
          data: {
            ownerId: opts.ownerId,
            agentId: opts.agent.id,
            phone: opts.phone,
            state: 'human_requested',
            humanRequestedAt: requestedAt,
          },
        })
      } catch {
        return {
          reply: '',
          stateChanged: false,
          skipSend: true,
          skipReason: 'human_already_requested',
        }
      }
    } else {
      const claimed = await prisma.agentConversation.updateMany({
        where: {
          id: current.id,
          state: { notIn: ['human_requested', 'human_active', 'stopped'] },
        },
        data: {
          state: 'human_requested',
          humanRequestedAt: requestedAt,
        },
      })
      if (!claimed.count) {
        return {
          reply: '',
          stateChanged: false,
          skipSend: true,
          skipReason: 'human_already_requested',
        }
      }
    }
    await prisma.agentFollowUp.updateMany({
      where: { ownerId: opts.ownerId, agentId: opts.agent.id, phone: opts.phone, status: 'scheduled' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    })
    const reason = String(action.arguments.reason || 'explicit_request')
    const notificationPhone = String(opts.config.notifyHumanPhone || opts.config.whatsappNumber || '').replace(/\D/g, '')
    if (notificationPhone) {
      await sendSystemText({
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        token: opts.token,
        to: notificationPhone,
        source: 'human_alert',
        text: `🚨 Human Support Requested\n\nCustomer Phone number: ${opts.phone}\nChatbot: ${opts.agent.name}\nReason: ${reason}`,
      }).catch((error) => console.error('[wa-ai] human alert failed', error))
    }
    return { reply: response, stateChanged: true }
  }

  if (action.name !== 'order_confirmed') {
    return { reply: collapseRepeatedPhrases(opts.fallbackReply), stateChanged: false }
  }

  const data = (action.arguments.order_data || {}) as AgentOrderData
  data.customer_phone = opts.phone
  const fingerprint = orderFingerprint(opts.phone, data)
  const recent = await prisma.agentOrder.findFirst({
    where: {
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (recent) {
    return {
      reply: fillConfirmationTemplate(opts.config.confirmationTemplate, data, opts.phone),
      stateChanged: false,
    }
  }

  const bucket = Math.floor(Date.now() / (10 * 60 * 1000))
  const externalId = `qunvert:${opts.ownerId}:${opts.agent.id}:${opts.phone}:${bucket}`
  const claim = await prisma.agentOrder.create({
    data: {
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      externalId,
      fingerprint,
      orderJson: JSON.stringify(data),
    },
  }).catch(() => null)
  if (!claim) {
    return {
      reply: fillConfirmationTemplate(opts.config.confirmationTemplate, data, opts.phone),
      stateChanged: false,
    }
  }

  try {
    const created = await createAgentOrder(opts.token, {
      externalId,
      phone: opts.phone,
      data,
      agentName: opts.agent.name,
    })
    await prisma.$transaction([
      prisma.agentOrder.update({
        where: { id: claim.id },
        data: { gatewayId: created.orderId },
      }),
      prisma.agentConversation.upsert({
        where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
        create: {
          ownerId: opts.ownerId,
          agentId: opts.agent.id,
          phone: opts.phone,
          orderConfirmedAt: new Date(),
          pendingOrderJson: null,
        },
        update: {
          orderConfirmedAt: new Date(),
          pendingOrderJson: null,
        },
      }),
      prisma.agentFollowUp.updateMany({
        where: { ownerId: opts.ownerId, agentId: opts.agent.id, phone: opts.phone, status: 'scheduled' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      }),
    ])
  } catch (error) {
    await prisma.agentOrder.delete({ where: { id: claim.id } }).catch(() => {})
    throw error
  }

  await applyConversationLabel({
    ownerId: opts.ownerId,
    agentId: opts.agent.id,
    phone: opts.phone,
    label: opts.config.labels.orderConfirmation,
    slot: 'order_confirmation',
    token: opts.token,
  })

  const confirmation = fillConfirmationTemplate(opts.config.confirmationTemplate, data, opts.phone)
  const notifyPhone = String(opts.config.notifyOrderPhone || '').replace(/\D/g, '')
  if (notifyPhone) {
    const prefix = String(action.arguments.seller_notification_prefix || `✅ You got a new order from ${opts.phone}`)
    await sendSystemText({
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      token: opts.token,
      to: notifyPhone,
      source: 'order_alert',
      text: `${prefix}\n\n${confirmation}`,
    }).catch((error) => console.error('[wa-ai] order alert failed', error))
  }
  return { reply: confirmation, stateChanged: true }
}
