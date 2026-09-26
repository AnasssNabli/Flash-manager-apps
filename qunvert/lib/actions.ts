import type { Agent } from '@prisma/client'
import { leadAgentEnabled, type AgentConfiguration } from './agentConfig'
import { fillConfirmationTemplate, type ToolAction } from './aiRuntime'
import { prisma } from './db'
import { applyConversationLabel } from './labels'
import { leadCustomFieldLines, leadFieldsToCollect } from './leadForm'
import { sendLeadFlow } from './leadFlow'
import { createAgentOrder, orderFingerprint, type AgentOrderData, type CustomerOrder } from './orders'
import { finishOutbound, planOutbound } from './outbound'
import { collapseRepeatedPhrases, isDoNotAnswerTool } from './replyQuality'
import { sendText } from './wa'
import type { Product } from './products'
import { mergePendingOrderData, sendOrderVariantCarousel, sendProductVariantCarousel } from './variantCarousel'

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
  products: Product[]
  existingOrders: CustomerOrder[]
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

  if (action.name === 'send_order_variants') {
    const orderId = String(action.arguments.order_id || '').trim()
    const order = opts.existingOrders.find((item) => item.id === orderId)
    if (!order?.variants) {
      return {
        reply: collapseRepeatedPhrases(String(action.arguments.fallback_response || opts.fallbackReply || '').trim()),
        stateChanged: false,
      }
    }
    const ledger = await planOutbound({
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      kind: 'carousel',
      body: `[order variants] ${order.name || order.id}`,
      source: 'reply',
    })
    const sent = await sendOrderVariantCarousel(opts.token, order.id)
    await finishOutbound(ledger.id, sent)
    if (!sent.ok) {
      console.warn('[wa-ai] existing-order carousel failed', order.id, sent.error)
      return {
        reply: collapseRepeatedPhrases(String(action.arguments.fallback_response || opts.fallbackReply || '').trim()),
        stateChanged: false,
      }
    }
    const conversation = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      select: { pendingOrderJson: true },
    }).catch(() => null)
    let pending: Record<string, unknown> = {}
    try {
      pending = conversation?.pendingOrderJson ? JSON.parse(conversation.pendingOrderJson) : {}
    } catch {
      pending = {}
    }
    pending._order_variant_carousel = {
      orderId: order.id,
      orderName: order.name,
      productTitle: order.variants.productTitle,
      sentAt: Date.now(),
    }
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
    return { reply: response, stateChanged: true }
  }

  if (action.name === 'send_variant_carousel') {
    if (!leadAgentEnabled(opts.config)) {
      return { reply: response, stateChanged: false }
    }
    const requested = String(action.arguments.product_name || '').trim().toLocaleLowerCase()
    const product = opts.products.find((item) => item.title.trim().toLocaleLowerCase() === requested)
    if (!product || (product.variants || []).length < 2) {
      return { reply: response, stateChanged: false }
    }
    const current = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      select: { pendingOrderJson: true },
    }).catch(() => null)
    let prior: AgentOrderData = {}
    try {
      prior = current?.pendingOrderJson ? JSON.parse(current.pendingOrderJson) : {}
    } catch {
      prior = {}
    }
    const carouselState = prior._variant_carousel && typeof prior._variant_carousel === 'object'
      ? prior._variant_carousel as Record<string, unknown>
      : {}
    const recentlySent =
      String(carouselState.productId || '') === product.id &&
      Date.now() - Number(carouselState.sentAt || 0) < 24 * 60 * 60 * 1000
    if (recentlySent) return { reply: response, stateChanged: false }

    const ledger = await planOutbound({
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      kind: 'carousel',
      body: `[variant carousel] ${product.title}`,
      source: 'reply',
    })
    const sent = await sendProductVariantCarousel(opts.token, {
      to: opts.phone,
      product,
      agentId: opts.agent.id,
    })
    await finishOutbound(ledger.id, sent)
    if (!sent.ok) {
      console.warn('[wa-ai] variant carousel unavailable; using text options', sent.error)
      const options = (product.variants || [])
        .map((variant) => `• ${variant.title || 'Variant'} — ${variant.price} ${product.currency}`.trim())
        .join('\n')
      return { reply: `${response}${options ? `\n\n${options}` : ''}`.trim(), stateChanged: false }
    }
    prior._variant_carousel = {
      productId: product.id,
      productName: product.title,
      sentAt: Date.now(),
      pending: sent.pending === true,
    }
    await prisma.agentConversation.upsert({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      create: {
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        phone: opts.phone,
        pendingOrderJson: JSON.stringify(prior),
      },
      update: { pendingOrderJson: JSON.stringify(prior) },
    })
    return { reply: response, stateChanged: true }
  }

  if (action.name === 'order_summary_sent') {
    const incoming = (action.arguments.pending_data || {}) as AgentOrderData
    const current = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      select: { pendingOrderJson: true },
    }).catch(() => null)
    let existing: AgentOrderData = {}
    try {
      existing = current?.pendingOrderJson ? JSON.parse(current.pendingOrderJson) : {}
    } catch {
      existing = {}
    }
    const pending = mergePendingOrderData(existing, incoming)
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

  if (action.name === 'send_order_form') {
    const incoming = (action.arguments.pending_data || {}) as AgentOrderData
    const current = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
      select: { leadFormSentAt: true, pendingOrderJson: true },
    }).catch(() => null)
    let existing: AgentOrderData = {}
    try {
      existing = current?.pendingOrderJson ? JSON.parse(current.pendingOrderJson) : {}
    } catch {
      existing = {}
    }
    const pending = mergePendingOrderData(existing, incoming)
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
    if (current?.leadFormSentAt && Date.now() - current.leadFormSentAt.getTime() < 24 * 60 * 60 * 1000) {
      // Form already sent in this window: do not spam it again; answer normally.
      return { reply: response, stateChanged: true }
    }
    const ledger = await planOutbound({
      ownerId: opts.ownerId,
      agentId: opts.agent.id,
      phone: opts.phone,
      kind: 'flow',
      body: `[order form] ${response}`.slice(0, 2000),
      source: 'reply',
    })
    const sent = await sendLeadFlow(opts.token, {
      to: opts.phone,
      agentId: opts.agent.id,
      form: opts.config.leadForm,
      body: response,
    })
    await finishOutbound(ledger.id, sent)
    if (sent.ok) {
      await prisma.agentConversation.update({
        where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
        data: { leadFormSentAt: new Date() },
      }).catch(() => {})
      await applyConversationLabel({
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        phone: opts.phone,
        label: opts.config.labels.orderSummary,
        slot: 'order_summary',
        token: opts.token,
      })
      // The Flow message itself carried the text; nothing else to send this turn.
      return { reply: '', stateChanged: true, skipSend: true, skipReason: 'order_form_sent' }
    }
    console.error('[wa-ai] order form send failed, falling back to chat', sent.error)
    const labels = leadFieldsToCollect(opts.config.leadForm).filter((field) => field.required).map((field) => field.label)
    const ask = labels.length ? `\n\nPlease send me: ${labels.join(', ')}.` : ''
    return { reply: `${response}${ask}`.trim(), stateChanged: true }
  }

  if (action.name !== 'order_confirmed') {
    return { reply: collapseRepeatedPhrases(opts.fallbackReply), stateChanged: false }
  }

  if (!leadAgentEnabled(opts.config)) {
    return { reply: collapseRepeatedPhrases(opts.fallbackReply), stateChanged: false }
  }
  const current = await prisma.agentConversation.findUnique({
    where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
    select: { pendingOrderJson: true },
  }).catch(() => null)
  let existing: AgentOrderData = {}
  try {
    existing = current?.pendingOrderJson ? JSON.parse(current.pendingOrderJson) : {}
  } catch {
    existing = {}
  }
  return confirmAgentOrder({
    ...opts,
    data: mergePendingOrderData(existing, (action.arguments.order_data || {}) as AgentOrderData),
    sellerPrefix: typeof action.arguments.seller_notification_prefix === 'string' ? action.arguments.seller_notification_prefix : undefined,
    channel: 'chat',
  })
}

/**
 * Create the order in FlashManager and return the confirmation message.
 * Used by the `order_confirmed` tool and by WhatsApp Flow submissions.
 */
export async function confirmAgentOrder(opts: {
  ownerId: string
  token: string
  agent: Agent
  config: AgentConfiguration
  phone: string
  data: AgentOrderData
  sellerPrefix?: string
  channel: 'chat' | 'whatsapp_flow'
}): Promise<ActionResult> {
  const data = opts.data
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
      noteLines: leadCustomFieldLines(opts.config.leadForm, data),
      channel: opts.channel,
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
    const prefix = String(opts.sellerPrefix || `✅ You got a new order from ${opts.phone}`)
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
