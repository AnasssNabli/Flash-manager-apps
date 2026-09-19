import type { AgentSettings } from '@prisma/client'
import { productContext, type Product } from './products'

const MODEL = 'gpt-5.4-mini'

function langLine(language: string): string {
  switch (language) {
    case 'darija':
      return 'Reply in Algerian / Maghrebi Darija (Arabic script is fine, keep it spoken and natural).'
    case 'ar':
      return 'Reply in clear Arabic.'
    case 'fr':
      return 'Reply in French.'
    case 'en':
      return 'Reply in English.'
    default:
      return 'Match the customer language. If unclear, use Darija or French — whichever fits Maghreb COD sellers.'
  }
}

function toneLine(tone: string): string {
  switch (tone) {
    case 'sales':
      return 'Be commercial: mention the product, a benefit, and a next step (confirm, ask size, or send the link). Keep it short.'
    case 'concise':
      return 'Be very short. One or two sentences. No fluff.'
    default:
      return 'Be helpful and human. Answer the question. Do not sound like a bot or a call center.'
  }
}

export type AgentPolicies = {
  freeShipping?: boolean
  cashOnDelivery?: boolean
  exchange?: boolean
  returns?: boolean
}

async function complete(system: string, user: string, maxTokens = 280): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not configured')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(data?.error?.message || `openai_${res.status}`)
  const text = data.choices?.[0]?.message?.content?.trim() || ''
  if (!text) throw new Error('empty_ai_reply')
  return text.replace(/^["“]|["”]$/g, '').trim()
}

export async function draftReply(opts: {
  settings?: AgentSettings | null
  agentPrompt?: string | null
  inbound: string
  contactName?: string | null
  products?: Product[]
}): Promise<string> {
  const catalog = opts.products?.length
    ? `Catalogue the seller actually sells:\n${productContext(opts.products)}`
    : ''
  const extra = (opts.settings?.instructions || '').trim()
  const language = opts.settings?.language || 'auto'
  const tone = opts.settings?.tone || 'helpful'

  return complete(
    [
      'You are the seller\'s WhatsApp assistant. You write the next outbound message to a customer.',
      'Rules:',
      '- WhatsApp only. No markdown, no bullets, no hashtags.',
      '- Never invent an order status, tracking number, or discount.',
      '- Never mention FlashManager, Meta, or that you are an AI.',
      '- If you cannot help, say so briefly. Do not ask out-of-context clarification questions.',
      langLine(language),
      toneLine(tone),
      opts.agentPrompt ? `Agent brief (follow this):\n${opts.agentPrompt}` : '',
      extra ? `Seller instructions:\n${extra}` : '',
      catalog,
    ]
      .filter(Boolean)
      .join('\n'),
    `${opts.contactName ? `Customer name: ${opts.contactName}\n` : ''}Customer just wrote:\n${opts.inbound || '(non-text message)'}`,
  )
}

export async function draftAgentPrompt(opts: {
  language?: string
  storeName?: string | null
  productScope: 'all' | 'product'
  product?: Product | null
  policies: AgentPolicies
}): Promise<string> {
  const variants = (opts.product?.variants || [])
    .map((v) => {
      const price = v.price ? `${v.price} ${opts.product?.currency || ''}`.trim() : ''
      return `- ${v.title || 'Variant'}${price ? ` · ${price}` : ''}${v.sku ? ` · SKU ${v.sku}` : ''}`
    })
    .join('\n')

  const policies = [
    opts.policies.freeShipping ? 'Free shipping: yes' : 'Free shipping: no',
    opts.policies.cashOnDelivery ? 'Cash on delivery: yes' : 'Cash on delivery: no',
    opts.policies.exchange ? 'Exchange: yes' : 'Exchange: no',
    opts.policies.returns ? 'Returns: yes' : 'Returns: no',
  ].join('\n')

  return complete(
    [
      'Write a concise WhatsApp sales-agent brief the model will follow when answering customers.',
      'Write in the same language as the seller market (Darija/French/Arabic mix is fine).',
      'Include: what the agent sells, variants and prices if given, shipping/COD/exchange/returns, and how to close (ask size/city, confirm the order).',
      'Do not invent discounts or stock. No markdown headings. 8–16 short lines.',
      langLine(opts.language || 'auto'),
    ].join('\n'),
    [
      opts.storeName ? `Store: ${opts.storeName}` : '',
      opts.productScope === 'product' && opts.product
        ? `One product only:\n${opts.product.title}\n${opts.product.description || ''}\nPrice: ${opts.product.price} ${opts.product.currency || ''}\nVariants:\n${variants || '- default'}`
        : 'The agent answers for the whole catalog of this store. Do not lock it to one SKU.',
      `Policies:\n${policies}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    700,
  )
}

export async function draftCampaign(opts: {
  language: string
  productName: string
  productPrice?: string | null
  productDescription?: string | null
  extra?: string | null
}): Promise<string> {
  return complete(
    [
      'Write one WhatsApp campaign message a Maghreb COD seller can send to existing customers.',
      'Rules: no markdown, no hashtags, 2–5 short lines, one clear CTA (reply YES / ask size / order).',
      'Do not invent a discount unless the seller wrote one.',
      langLine(opts.language),
    ].join('\n'),
    [
      `Product: ${opts.productName}`,
      opts.productPrice ? `Price: ${opts.productPrice}` : '',
      opts.productDescription ? `About: ${opts.productDescription.slice(0, 400)}` : '',
      opts.extra ? `Seller note: ${opts.extra}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}
