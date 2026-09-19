export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { parseAgentConfig } from '@/lib/agentConfig'
import { generateAgentReply, type HistoryItem } from '@/lib/aiRuntime'
import { prisma } from '@/lib/db'
import { requireOwner } from '@/lib/fm'
import { listProducts, type Product } from '@/lib/products'
import { collapseRepeatedPhrases, isDoNotAnswerTool } from '@/lib/replyQuality'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const owner = await requireOwner(req, body)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const agentId = String(body.agentId || '')
  const message = String(body.message || '').trim()
  if (!agentId || !message) {
    return NextResponse.json({ error: 'agent_and_message_required' }, { status: 400 })
  }
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerId: owner.ownerId },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const config = parseAgentConfig(body.policies && typeof body.policies === 'object' ? body.policies : agent.policiesJson)
  const agentName = String(body.name || agent.name || 'AI sales agent').slice(0, 120)
  let products: Product[] = []
  if (Array.isArray(body.products)) {
    products = body.products
  } else {
    try {
      products = !config.allProducts && agent.productJson
        ? JSON.parse(agent.productJson)
        : await listProducts(owner.token, '', 100, agent.storeDomain || '')
    } catch {
      products = []
    }
  }
  const history: HistoryItem[] = Array.isArray(body.history)
    ? body.history
        .slice(-50)
        .map((item: { role?: string; text?: string }): HistoryItem => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          text: String(item?.text || '').slice(0, 4000),
        }))
    : []
  const isFirstCustomerMessage = history.filter((item) => item.role === 'user').length === 0
  const openerAlreadyUsed = history.some((item) => item.role === 'assistant')
  if (isFirstCustomerMessage && config.autoReplyOpener.trim() && !openerAlreadyUsed) {
    return NextResponse.json({
      reply: config.autoReplyOpener.trim(),
      action: null,
      preview: true,
    })
  }
  const result = await generateAgentReply({
    ownerId: owner.ownerId,
    agentName,
    config,
    products,
    history,
    latestMessage: message,
    customerPhone: '0612345678',
    isFirstCustomerMessage: isFirstCustomerMessage && !openerAlreadyUsed,
    recentOrderWithin10Min: false,
  })
  if (isDoNotAnswerTool(result.action?.name)) {
    return NextResponse.json({
      reply: '',
      action: 'donotanswer',
      skipped: true,
      skipReason: String(result.action?.arguments.explanation || result.action?.arguments.reason || 'out of context'),
      preview: true,
    })
  }
  return NextResponse.json({
    reply: collapseRepeatedPhrases(result.reply) || 'No preview reply was generated.',
    action: result.action?.name || null,
    preview: true,
  })
}
