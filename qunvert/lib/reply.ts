import type { Agent } from '@prisma/client'
import { confirmAgentOrder, executeAgentAction } from './actions'
import { blockedPhone, leadAgentEnabled, parseAgentConfig, type AgentConfiguration } from './agentConfig'
import { leadResponseToOrderData } from './leadForm'
import { parseLeadFlowReply, type LeadFlowReply } from './leadFlow'
import {
  humanTookOver,
  isOlderHumanConversation,
  matchesStopWord,
  promisedHumanHandoff,
  remainingResponseBudget,
  scoreProduct,
  shouldPauseForHuman,
  shouldWaitForRapidBatch,
  hitAiReplyLimit,
} from './gates'
import {
  classifyCustomLabels,
  generateAgentReply,
  transcribeAudio,
  type HistoryItem,
} from './aiRuntime'
import { chargeCredits } from './credits'
import { prisma } from './db'
import { creditBalance } from './fm'
import { applyConversationLabel } from './labels'
import { sendOutputWithMedia } from './media'
import {
  listBuyers,
  listCustomerOrders,
  phoneKey,
  updateExistingOrderVariant,
  type AgentOrderData,
} from './orders'
import { clampFollowUpDueAt } from './followups'
import {
  finishOutbound,
  isKnownAgentOutbound,
  planOutbound,
  recentOutboundLedger,
} from './outbound'
import { listProducts, type Product } from './products'
import {
  audioFileName,
  historyLabelForMessage,
  isAudioMessage,
  isVisualMessage,
  mediaIdOf,
  sniffImageMime,
  toDataUrl,
} from './inboundMedia'
import { collapseRepeatedPhrases, customerAskedToWait, isSessionWindowError } from './replyQuality'
import {
  downloadWhatsAppMedia,
  getThread,
  inCustomerWindow,
  lastInbound,
  listConvos,
  messageBody,
  messageId,
  messageTime,
  sendText,
  type Convo,
  type ThreadMessage,
} from './wa'
import {
  matchVariantChoice,
  matchOrderVariantChoice,
  mergePendingOrderData,
  parseVariantChoice,
  variantOrderData,
  type MatchedVariant,
} from './variantCarousel'

const MAX_PER_TICK = 8
const RAPID_WINDOW_MS = 5_000

function parseProducts(agent: Agent): Product[] {
  try {
    const parsed = agent.productJson ? JSON.parse(agent.productJson) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function pickAgent(agents: Agent[], inbound: string): Agent {
  let best: Agent | null = null
  let bestScore = -1
  for (const agent of agents) {
    const config = parseAgentConfig(agent.policiesJson)
    if (config.desiredStatus !== 'active') continue
    const products = parseProducts(agent)
    const score = config.allProducts && !products.length
      ? 1
      : Math.max(0, ...products.map((product) => scoreProduct(inbound, product.title, product.description)))
    const ranked = score + (config.allProducts ? 0.1 : 0)
    if (ranked > bestScore) {
      best = agent
      bestScore = ranked
    }
  }
  return best || agents[0]
}

function isAutomatedPlatformMessage(message: ThreadMessage) {
  const metadata = message.metadata || {}
  const sentBy = String(metadata.sent_by || '')
  const template = String(metadata.template_name || '')
  return sentBy === 'carousel' || template.startsWith('fm_carousel_')
}

function threadHistory(thread: ThreadMessage[]): HistoryItem[] {
  return [...thread]
    .sort((a, b) => messageTime(a) - messageTime(b))
    .slice(-50)
    .map((message) => ({
      role: message.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      text: historyLabelForMessage(message),
      type: message.type,
    }))
}

function rapidInboundText(thread: ThreadMessage[], latest: ThreadMessage) {
  const latestAt = messageTime(latest)
  return [...thread]
    .filter((message) =>
      message.direction === 'inbound' &&
      latestAt - messageTime(message) >= 0 &&
      latestAt - messageTime(message) <= RAPID_WINDOW_MS,
    )
    .sort((a, b) => messageTime(a) - messageTime(b))
    .map(messageBody)
    .filter(Boolean)
    .join('\n')
}

/**
 * Customer submitted the WhatsApp order form: merge the answers with the items
 * the AI stored when it sent the form, create the FlashManager order, and send
 * the confirmation message. No AI call, no credits.
 */
async function handleLeadFormReply(opts: {
  ownerId: string
  token: string
  agent: Agent
  config: AgentConfiguration
  phone: string
  inboundId: string
  claimId: string
  reply: LeadFlowReply
}): Promise<void> {
  const conversation = await prisma.agentConversation.findUnique({
    where: { agentId_phone: { agentId: opts.agent.id, phone: opts.phone } },
    select: { id: true, pendingOrderJson: true },
  }).catch(() => null)
  let pending: AgentOrderData = {}
  try {
    pending = conversation?.pendingOrderJson ? JSON.parse(conversation.pendingOrderJson) : {}
  } catch {
    pending = {}
  }
  const data: AgentOrderData = {
    ...pending,
    ...leadResponseToOrderData(opts.config.leadForm, opts.reply.values),
  }
  const result = await confirmAgentOrder({
    ownerId: opts.ownerId,
    token: opts.token,
    agent: opts.agent,
    config: opts.config,
    phone: opts.phone,
    data,
    channel: 'whatsapp_flow',
  })
  const output = collapseRepeatedPhrases(result.reply)
  if (!output.trim()) throw new Error('empty_confirmation')
  const ledger = await planOutbound({
    ownerId: opts.ownerId,
    agentId: opts.agent.id,
    phone: opts.phone,
    kind: 'text',
    body: output,
    source: 'reply',
  })
  const sent = await sendText(opts.token, opts.phone, output)
  await finishOutbound(ledger.id, sent)
  if (!sent.ok) throw new Error(sent.error || 'confirmation_send_failed')
  await prisma.$transaction([
    ...(conversation?.id ? [prisma.agentConversation.update({
      where: { id: conversation.id },
      data: { aiReplyCount: { increment: 1 } },
    })] : []),
    prisma.replyLog.create({
      data: {
        ownerId: opts.ownerId,
        phone: opts.phone,
        inboundId: opts.inboundId,
        inbound: `[order form] ${JSON.stringify(opts.reply.values)}`.slice(0, 2000),
        outbound: output.slice(0, 2000),
        credits: 0,
        status: 'sent',
      },
    }),
    prisma.agentInboundClaim.update({
      where: { id: opts.claimId },
      data: { status: 'completed', completedAt: new Date() },
    }),
  ])
}

async function finishClaim(id: string, status: string, error?: string) {
  await prisma.agentInboundClaim.update({
    where: { id },
    data: {
      status,
      error: error ? error.slice(0, 1000) : null,
      completedAt: new Date(),
    },
  }).catch(() => {})
}

async function skipClaim(id: string, reason: string) {
  await finishClaim(id, 'skipped', reason)
}

async function recordSkip(opts: {
  ownerId: string
  phone: string
  inboundId: string
  inbound: string
  status: string
  error: string
  claimId?: string
}) {
  await prisma.replyLog.create({
    data: {
      ownerId: opts.ownerId,
      phone: opts.phone,
      inboundId: opts.inboundId,
      inbound: opts.inbound.slice(0, 2000),
      outbound: '',
      credits: 0,
      status: opts.status,
      error: opts.error.slice(0, 500),
    },
  }).catch(() => {})
  if (opts.claimId) await skipClaim(opts.claimId, opts.error)
  console.log(`[wa-ai] ${opts.status}`, opts.phone, opts.error)
}

async function selectedProducts(token: string, agent: Agent, config: AgentConfiguration) {
  if (config.allProducts) {
    return listProducts(token, '', 100, agent.storeDomain || '')
  }
  return parseProducts(agent)
}

async function recentOrderExists(ownerId: string, agentId: string, phone: string) {
  return !!(await prisma.agentOrder.findFirst({
    where: {
      ownerId,
      agentId,
      phone,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    select: { id: true },
  }))
}

async function hasAnyOrder(
  ownerId: string,
  agentId: string,
  phone: string,
  token: string,
) {
  const local = await prisma.agentConversation.findUnique({
    where: { agentId_phone: { agentId, phone } },
    select: { orderConfirmedAt: true },
  })
  if (local?.orderConfirmedAt) return true
  const buyers = await listBuyers(token, { phones: [phone] })
  return buyers.some((buyer) => phoneKey(buyer) === phoneKey(phone))
}

async function applyCustomLabels(
  ownerId: string,
  agent: Agent,
  config: AgentConfiguration,
  phone: string,
  history: HistoryItem[],
  token: string,
) {
  if (!config.labels.custom.length) return
  const existing = await prisma.agentConversationLabel.findMany({
    where: { ownerId, agentId: agent.id, phone },
    select: { label: true },
  })
  const present = new Set(existing.map((item) => item.label))
  const candidates = config.labels.custom.filter((item) => !present.has(item.label))
  if (!candidates.length) return
  const labels = await classifyCustomLabels({ ownerId, candidates, history })
  for (const label of labels) {
    await applyConversationLabel({
      ownerId,
      agentId: agent.id,
      phone,
      label,
      slot: 'custom',
      token,
    })
  }
}

async function scheduleFollowUp(opts: {
  ownerId: string
  agent: Agent
  config: AgentConfiguration
  phone: string
  inboundId: string
  sourceInboundAt: Date
}) {
  if (!opts.config.followUp.enabled) return
  const delayMs = (
    Math.max(0, opts.config.followUp.hours) * 60 +
    Math.max(0, opts.config.followUp.minutes)
  ) * 60 * 1000
  const dueAt = clampFollowUpDueAt(
    new Date(Date.now() + delayMs),
    opts.sourceInboundAt,
  )
  await prisma.$transaction([
    prisma.agentFollowUp.updateMany({
      where: {
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        phone: opts.phone,
        status: 'scheduled',
      },
      data: { status: 'cancelled', cancelledAt: new Date() },
    }),
    prisma.agentFollowUp.create({
      data: {
        ownerId: opts.ownerId,
        agentId: opts.agent.id,
        phone: opts.phone,
        sourceInboundId: opts.inboundId,
        dueAt,
      },
    }),
  ])
}

async function loadVisual(token: string, message: ThreadMessage, ownerId: string) {
  const mediaId = mediaIdOf(message)
  if (!mediaId) return null
  try {
    const media = await downloadWhatsAppMedia(token, mediaId, ownerId)
    if (media.bytes.byteLength > 6 * 1024 * 1024) return null
    const contentType = sniffImageMime(media.bytes, media.contentType)
    return {
      url: toDataUrl(media.bytes, contentType),
      caption: messageBody(message),
    }
  } catch (error) {
    console.error('[wa-ai] image download failed', mediaId, error)
    return null
  }
}

async function buildInboundContent(
  token: string,
  config: AgentConfiguration,
  inbound: ThreadMessage,
  thread: ThreadMessage[],
  ownerId: string,
): Promise<{ text: string; images: { url: string; caption?: string }[]; skipReason?: string }> {
  const images: { url: string; caption?: string }[] = []
  if (isAudioMessage(inbound)) {
    if (!config.respondToAudio) return { text: '', images, skipReason: 'audio_disabled' }
    const mediaId = mediaIdOf(inbound)
    if (!mediaId) return { text: '', images, skipReason: 'audio_media_missing' }
    try {
      const media = await downloadWhatsAppMedia(token, mediaId, ownerId)
      const transcript = await transcribeAudio(media.bytes, audioFileName(media.contentType))
      if (!transcript) return { text: '', images, skipReason: 'audio_empty_transcript' }
      return { text: transcript, images }
    } catch (error) {
      console.error('[wa-ai] audio transcribe failed', mediaId, error)
      return { text: '', images, skipReason: 'audio_transcribe_failed' }
    }
  }

  const latestAt = messageTime(inbound)
  const recent = thread.filter((message) =>
    message.direction === 'inbound' &&
    latestAt - messageTime(message) >= 0 &&
    latestAt - messageTime(message) <= RAPID_WINDOW_MS,
  )
  const visualMessages = recent.filter(isVisualMessage)
  for (const message of visualMessages.slice(-3)) {
    const image = await loadVisual(token, message, ownerId)
    if (image) images.push(image)
  }

  const caption = rapidInboundText(thread, inbound) || messageBody(inbound)
  if (images.length) {
    return {
      text: caption || '📷 Photo',
      images,
    }
  }
  if (isVisualMessage(inbound)) {
    return { text: '', images, skipReason: 'image_download_failed' }
  }
  const type = String(inbound.type || 'text')
  return { text: caption || `[${type} message]`, images }
}

export type ReplyOutcome = 'sent' | 'skipped' | 'failed' | 'wait'

function whatsAppAgents(ownerId: string) {
  return prisma.agent.findMany({
    where: {
      ownerId,
      enabled: true,
      assignments: { some: { channel: 'whatsapp' } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/** Phones whose latest inbound was already claimed, so the sweep skips re-fetching their thread. */
async function claimedSinceLastInbound(ownerId: string, convos: Convo[]): Promise<Set<string>> {
  if (!convos.length) return new Set()
  const inboundAt = new Map(convos.map((convo) => [convo.phone, new Date(convo.lastInboundAt || 0).getTime()]))
  const claims = await prisma.agentInboundClaim.findMany({
    where: {
      ownerId,
      phone: { in: [...inboundAt.keys()] },
      createdAt: { gte: new Date(Math.min(...inboundAt.values())) },
    },
    select: { phone: true, createdAt: true },
  })
  return new Set(claims
    .filter((claim) => claim.createdAt.getTime() >= (inboundAt.get(claim.phone) ?? Infinity))
    .map((claim) => claim.phone))
}

/** Safety-net sweep; inbound events are the primary trigger (see replyQueue). */
export async function processOwnerReplies(ownerId: string, token: string): Promise<number> {
  const agents = await whatsAppAgents(ownerId)
  if (!agents.length) return 0

  const convos = (await listConvos(token, 'needs_reply', 40))
    .filter((convo) => inCustomerWindow(convo.lastInboundAt))
  const claimed = await claimedSinceLastInbound(ownerId, convos)
  let sent = 0
  for (const convo of convos) {
    if (sent >= MAX_PER_TICK) break
    if (claimed.has(convo.phone)) continue
    if (await replyToConversation(ownerId, token, agents, convo.phone, convo) === 'sent') sent += 1
  }
  return sent
}

export async function processConversationReply(ownerId: string, token: string, phone: string): Promise<ReplyOutcome> {
  const agents = await whatsAppAgents(ownerId)
  if (!agents.length) return 'skipped'
  return replyToConversation(ownerId, token, agents, phone)
}

async function replyToConversation(
  ownerId: string,
  token: string,
  agents: Agent[],
  phone: string,
  hint?: Pick<Convo, 'lastInboundAt' | 'lastMessage'>,
): Promise<ReplyOutcome> {
  const thread = await getThread(token, phone)
  const inbound = lastInbound(thread)
  if (!inbound) return 'skipped'
  const inboundAt = messageTime(inbound)
    ? new Date(messageTime(inbound)).toISOString()
    : hint?.lastInboundAt ?? null
  const initialText = messageBody(inbound) || hint?.lastMessage || ''
  const flowReply = parseLeadFlowReply(inbound)
  const variantChoice = parseVariantChoice(inbound)
  const flowAgent = flowReply?.agentId ? agents.find((candidate) => candidate.id === flowReply.agentId) : null
  const agent = flowAgent || pickAgent(agents, initialText)
  const config = parseAgentConfig(agent.policiesJson)
  if (config.desiredStatus !== 'active') return 'skipped'

  const inboundId = messageId(inbound) || `${phone}:${hint?.lastInboundAt ?? inboundAt}`
  if (shouldWaitForRapidBatch(messageTime(inbound) || new Date(inboundAt || 0).getTime(), Date.now(), RAPID_WINDOW_MS)) {
    return 'wait'
  }
  const alreadyLogged = await prisma.replyLog.findUnique({
    where: { ownerId_inboundId: { ownerId, inboundId } },
    select: { id: true },
  })
  if (alreadyLogged) return 'skipped'
  // Skipped inbounds (human mode, audio disabled, …) keep the conversation in needs_reply
  // with no reply log; the claim row is what remembers we already looked at them.
  const alreadyClaimed = await prisma.agentInboundClaim.findUnique({
    where: { ownerId_inboundId: { ownerId, inboundId } },
    select: { id: true },
  })
  if (alreadyClaimed) return 'skipped'
  if (!inCustomerWindow(inboundAt)) {
    await recordSkip({
      ownerId,
      phone,
      inboundId,
      inbound: initialText,
      status: 'skipped',
      error: 'outside_customer_window',
    })
    return 'skipped'
  }
  const claim = await prisma.agentInboundClaim.create({
    data: {
      ownerId,
      agentId: agent.id,
      phone,
      inboundId,
    },
  }).catch(() => null)
  if (!claim) return 'skipped'

  try {
    await prisma.agentFollowUp.updateMany({
      where: { ownerId, agentId: agent.id, phone, status: 'scheduled' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    })

    if (blockedPhone(config, phone)) {
      await skipClaim(claim.id, 'blocked_phone')
      return 'skipped'
    }
    if (flowReply && leadAgentEnabled(config)) {
      await handleLeadFormReply({
        ownerId,
        token,
        agent,
        config,
        phone,
        inboundId,
        claimId: claim.id,
        reply: flowReply,
      })
      return 'sent'
    }
    if (!config.answerAfterOrder && await hasAnyOrder(ownerId, agent.id, phone, token)) {
      await skipClaim(claim.id, 'answer_after_order_disabled')
      return 'skipped'
    }

    const ledger = await recentOutboundLedger(ownerId, phone)
    const legacyReplies = await prisma.replyLog.findMany({
      where: {
        ownerId,
        phone,
        status: 'sent',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { outbound: true, createdAt: true },
      take: 100,
    })
    const humanOutbound = thread.filter((message) =>
      message.direction === 'outbound' &&
      !isAutomatedPlatformMessage(message) &&
      !isKnownAgentOutbound(message, ledger),
    ).filter((message) =>
      !legacyReplies.some((reply) =>
        reply.outbound.trim() === messageBody(message) &&
        Math.abs(reply.createdAt.getTime() - messageTime(message)) <= 2 * 60 * 1000,
      ),
    )
    const inboundMessages = thread.filter((message) => message.direction === 'inbound')
    const isFirstCustomerMessage = inboundMessages.length <= 1
    const agentHasReplied = ledger.some((row) => row.agentId === agent.id && row.source === 'reply')
    const lastAiSentAt = ledger
      .filter((row) => row.agentId === agent.id && row.source === 'reply' && row.sentAt)
      .reduce((max, row) => Math.max(max, row.sentAt!.getTime()), 0)

    const stoppedByMessage = humanOutbound.some((message) =>
      matchesStopWord(config.stopWord, messageBody(message)),
    )
    if (stoppedByMessage) {
      await prisma.agentConversation.upsert({
        where: { agentId_phone: { agentId: agent.id, phone } },
        create: {
          ownerId,
          agentId: agent.id,
          phone,
          state: 'stopped',
          stoppedAt: new Date(),
        },
        update: { state: 'stopped', stoppedAt: new Date() },
      }).catch((error) => console.error('[wa-ai] conversation state fail-open', error))
      await skipClaim(claim.id, 'stop_word')
      return 'skipped'
    }

    const latestHuman = humanOutbound.sort((a, b) => messageTime(b) - messageTime(a))[0]
    const tookOver = humanTookOver(latestHuman ? messageTime(latestHuman) : null, lastAiSentAt)
    const existingConversation = await prisma.agentConversation.findUnique({
      where: { agentId_phone: { agentId: agent.id, phone } },
    })
    const priorLastCustomerAt = existingConversation?.lastCustomerAt ?? null
    let conversation = await prisma.agentConversation.upsert({
      where: { agentId_phone: { agentId: agent.id, phone } },
      create: {
        ownerId,
        agentId: agent.id,
        phone,
        firstCustomerAt: new Date(messageTime(inbound) || Date.now()),
        lastCustomerAt: new Date(messageTime(inbound) || Date.now()),
        latestInboundId: inboundId,
        latestInboundAt: new Date(messageTime(inbound) || Date.now()),
        aiReplyCount: legacyReplies.length,
      },
      update: {
        lastCustomerAt: new Date(messageTime(inbound) || Date.now()),
        latestInboundId: inboundId,
        latestInboundAt: new Date(messageTime(inbound) || Date.now()),
      },
    }).catch((error) => {
      console.error('[wa-ai] conversation state fail-open', error)
      return {
        id: '',
        ownerId,
        agentId: agent.id,
        phone,
        state: 'ai_active',
        firstCustomerAt: new Date(),
        lastCustomerAt: new Date(),
        lastHumanAt: null,
        humanRequestedAt: null,
        stoppedAt: null,
        orderConfirmedAt: null,
        pendingOrderJson: null,
        leadFormSentAt: null,
        aiReplyCount: 0,
        latestInboundId: inboundId,
        latestInboundAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })
    if (conversation.state === 'stopped') {
      await skipClaim(claim.id, 'conversation_stopped')
      return 'skipped'
    }

    if (isOlderHumanConversation({
      answerOlderConversations: config.answerOlderConversations,
      isFirstCustomerMessage,
      agentHasReplied,
      humanOutboundCount: humanOutbound.length,
    })) {
      await skipClaim(claim.id, 'older_human_conversation')
      return 'skipped'
    }

    if (conversation.id && latestHuman && tookOver && messageTime(latestHuman) > Number(conversation.lastHumanAt || 0)) {
      conversation = await prisma.agentConversation.update({
        where: { id: conversation.id },
        data: {
          state: 'human_active',
          lastHumanAt: new Date(messageTime(latestHuman)),
        },
      }).catch((error) => {
        console.error('[wa-ai] conversation state fail-open', error)
        return { ...conversation, state: 'human_active', lastHumanAt: new Date(messageTime(latestHuman)) }
      })
    }

    const humanGate = {
      resumeAfterTakeover: config.resumeAfterTakeover,
      resumeAfterMinutes: config.resumeAfterMinutes,
      isFirstCustomerMessage,
      humanTookOver: tookOver,
      lastCustomerAt: priorLastCustomerAt,
    }
    if (shouldPauseForHuman({
      ...humanGate,
      state: conversation.state as 'ai_active' | 'human_requested' | 'human_active' | 'stopped',
      lastHumanAt: conversation.lastHumanAt,
      humanRequestedAt: conversation.humanRequestedAt,
    })) {
      await skipClaim(claim.id, 'human_mode')
      return 'skipped'
    }
    if (conversation.id && (conversation.state === 'human_active' || conversation.state === 'human_requested') && !shouldPauseForHuman({
      ...humanGate,
      state: conversation.state,
      lastHumanAt: conversation.lastHumanAt,
      humanRequestedAt: conversation.humanRequestedAt,
    })) {
      conversation = await prisma.agentConversation.update({
        where: { id: conversation.id },
        data: { state: 'ai_active', humanRequestedAt: null },
      }).catch((error) => {
        console.error('[wa-ai] conversation state fail-open', error)
        return { ...conversation, state: 'ai_active', humanRequestedAt: null }
      })
    }

    if (hitAiReplyLimit(config.maxResponses, conversation.aiReplyCount)) {
      if (conversation.id) {
        await prisma.agentConversation.update({
          where: { id: conversation.id },
          data: { state: 'stopped', stoppedAt: new Date() },
        }).catch((error) => console.error('[wa-ai] conversation state fail-open', error))
      }
      await skipClaim(claim.id, 'max_responses')
      return 'skipped'
    }

    const balance = await creditBalance(token)
    if (balance !== null && balance <= 0) {
      await skipClaim(claim.id, 'insufficient_credits')
      return 'skipped'
    }

    const history = threadHistory(thread)
    const [products, existingOrders] = await Promise.all([
      selectedProducts(token, agent, config),
      listCustomerOrders(token, phone),
    ])
    let selectedVariant: MatchedVariant | null = null
    let orderEditResult: {
      orderId: string
      orderName: string
      status: 'updated' | 'failed'
      shopifyUpdated?: boolean
      error?: string
    } | null = null
    if (variantChoice) {
      let existing: AgentOrderData = {}
      try {
        existing = conversation.pendingOrderJson ? JSON.parse(conversation.pendingOrderJson) : {}
      } catch {
        existing = {}
      }
      const orderCarouselState = existing._order_variant_carousel && typeof existing._order_variant_carousel === 'object'
        ? existing._order_variant_carousel as Record<string, unknown>
        : {}
      const referencedOrder = existingOrders.find((order) =>
        order.id === variantChoice.contextKey || order.name === variantChoice.contextKey,
      ) || existingOrders.find((order) => order.id === String(orderCarouselState.orderId || ''))

      if (referencedOrder) {
        selectedVariant = matchOrderVariantChoice(products, referencedOrder, variantChoice)
      }
      if (referencedOrder && selectedVariant) {
        const update = await updateExistingOrderVariant(token, {
          order: referencedOrder,
          variant: selectedVariant,
        })
        orderEditResult = {
          orderId: referencedOrder.id,
          orderName: referencedOrder.name,
          status: update.ok ? 'updated' : 'failed',
          shopifyUpdated: update.shopifyUpdated,
          error: update.error,
        }
        existing._order_edit = {
          orderId: referencedOrder.id,
          orderName: referencedOrder.name,
          productId: selectedVariant.productId,
          productName: selectedVariant.productName,
          variantId: selectedVariant.variantId,
          variantTitle: selectedVariant.variantTitle,
          sku: selectedVariant.sku,
          status: orderEditResult.status,
          updatedAt: Date.now(),
        }
        delete existing._order_variant_carousel
        const merged = mergePendingOrderData(existing, variantOrderData(selectedVariant))
        conversation = conversation.id
          ? await prisma.agentConversation.update({
              where: { id: conversation.id },
              data: { pendingOrderJson: JSON.stringify(merged) },
            }).catch(() => ({ ...conversation, pendingOrderJson: JSON.stringify(merged) }))
          : await prisma.agentConversation.upsert({
              where: { agentId_phone: { agentId: agent.id, phone } },
              create: {
                ownerId,
                agentId: agent.id,
                phone,
                pendingOrderJson: JSON.stringify(merged),
              },
              update: { pendingOrderJson: JSON.stringify(merged) },
            })
      } else if (leadAgentEnabled(config)) {
        const carouselState = existing._variant_carousel && typeof existing._variant_carousel === 'object'
          ? existing._variant_carousel as Record<string, unknown>
          : {}
        const sentProductId = String(carouselState.productId || '').trim()
        selectedVariant = matchVariantChoice(products, {
          ...variantChoice,
          contextKey: sentProductId || variantChoice.contextKey,
        })
      }
    }
    const content = await buildInboundContent(token, config, inbound, thread, ownerId)
    if (content.skipReason) {
      await skipClaim(claim.id, content.skipReason)
      return 'skipped'
    }
    if (customerAskedToWait(content.text)) {
      await recordSkip({
        ownerId,
        phone,
        inboundId,
        inbound: content.text,
        status: 'skipped',
        error: 'customer_asked_to_wait',
        claimId: claim.id,
      })
      return 'skipped'
    }
    let output = ''
    let charged = 0
    let handedOffToHuman = false
    const useFirstMessageOpener = isFirstCustomerMessage && existingOrders.length === 0
    if (useFirstMessageOpener && config.autoReplyOpener.trim()) {
      output = config.autoReplyOpener.trim()
    } else {
      if (conversation.id) {
        const latest = await prisma.agentConversation.findUnique({ where: { id: conversation.id } })
        if (latest) conversation = latest
        if (shouldPauseForHuman({
          ...humanGate,
          state: conversation.state as 'ai_active' | 'human_requested' | 'human_active' | 'stopped',
          lastHumanAt: conversation.lastHumanAt,
          humanRequestedAt: conversation.humanRequestedAt,
        })) {
          await skipClaim(claim.id, 'human_mode')
          return 'skipped'
        }
      }
      const generation = await generateAgentReply({
        ownerId,
        agentName: agent.name,
        config,
        products,
        history,
        latestMessage: content.text,
        customerPhone: phone,
        isFirstCustomerMessage: useFirstMessageOpener,
        recentOrderWithin10Min: await recentOrderExists(ownerId, agent.id, phone),
        images: content.images,
        defaultLanguage: agent.language,
        selectedVariant,
        existingOrders,
        orderEditResult,
      })
      let action = generation.action
      const candidateText = String(action?.arguments.response || generation.reply || '')
      if (promisedHumanHandoff(candidateText) && action?.name !== 'request_human_agent') {
        action = {
          name: 'request_human_agent',
          arguments: {
            response: candidateText,
            reason: 'explicit_request',
          },
        }
      }
      const actionResult = await executeAgentAction({
        ownerId,
        token,
        agent,
        config,
        phone,
        action,
        fallbackReply: generation.reply,
        products,
        existingOrders,
      })
      if (actionResult.skipSend) {
        await recordSkip({
          ownerId,
          phone,
          inboundId,
          inbound: content.text,
          status: actionResult.skipReason?.startsWith('donotanswer') ? 'donotanswer' : 'skipped',
          error: actionResult.skipReason || 'donotanswer',
          claimId: claim.id,
        })
        return 'skipped'
      }
      if (!actionResult.stateChanged && conversation.id) {
        const latest = await prisma.agentConversation.findUnique({ where: { id: conversation.id } })
        if (latest && (latest.state === 'human_requested' || latest.state === 'human_active' || latest.state === 'stopped')) {
          await skipClaim(claim.id, 'human_mode')
          return 'skipped'
        }
      }
      handedOffToHuman = action?.name === 'request_human_agent'
      output = collapseRepeatedPhrases(actionResult.reply)
      if (!output.trim()) throw new Error('empty_ai_reply')
      charged = Math.max(1, Math.floor(generation.usage.estimatedCostUsd * 2000))
      await chargeCredits(
        token,
        charged,
        `wa-ai-reply:${phone}`,
        `reply:${ownerId}:${inboundId}`,
      )
    }
    output = collapseRepeatedPhrases(output)
    if (!output.trim()) throw new Error('empty_ai_reply')

    const remainingBudget = remainingResponseBudget(config.maxResponses, conversation.aiReplyCount)
    const delivery = await sendOutputWithMedia({
      token,
      to: phone,
      output,
      remainingBudget,
      beforeSend: async (item) => {
        const row = await planOutbound({
          ownerId,
          agentId: agent.id,
          phone,
          kind: item.kind,
          body: item.body,
          source: 'reply',
        })
        return row.id
      },
      afterSend: finishOutbound,
    })

    await prisma.$transaction([
      ...(conversation.id ? [prisma.agentConversation.update({
        where: { id: conversation.id },
        data: {
          ...(handedOffToHuman ? {} : { state: 'ai_active' }),
          aiReplyCount: { increment: delivery.sent },
        },
      })] : []),
      prisma.replyLog.create({
        data: {
          ownerId,
          phone,
          inboundId,
          inbound: content.text.slice(0, 2000),
          outbound: output.slice(0, 2000),
          credits: charged,
          status: 'sent',
        },
      }),
      prisma.agentInboundClaim.update({
        where: { id: claim.id },
        data: { status: 'completed', completedAt: new Date() },
      }),
    ])

    if (isFirstCustomerMessage) {
      await applyConversationLabel({
        ownerId,
        agentId: agent.id,
        phone,
        label: config.labels.newCustomer,
        slot: 'new_customer',
        token,
      })
    }
    if (!handedOffToHuman) {
      await scheduleFollowUp({
        ownerId,
        agent,
        config,
        phone,
        inboundId,
        sourceInboundAt: new Date(messageTime(inbound) || Date.now()),
      })
    }
    void applyCustomLabels(
      ownerId,
      agent,
      config,
      phone,
      [...history, { role: 'assistant', text: output }],
      token,
    ).catch((error) => console.error('[wa-ai] custom labels failed', error))
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reply_failed'
    const skippedWindow = isSessionWindowError(message)
    await finishClaim(claim.id, skippedWindow ? 'skipped' : 'failed', message)
    await prisma.replyLog.create({
      data: {
        ownerId,
        phone,
        inboundId,
        inbound: initialText.slice(0, 2000),
        outbound: '',
        credits: 0,
        status: skippedWindow ? 'skipped' : 'failed',
        error: message.slice(0, 500),
      },
    }).catch(() => {})
    console.error('[wa-ai] reply failed', ownerId, message)
    return 'failed'
  }
}
