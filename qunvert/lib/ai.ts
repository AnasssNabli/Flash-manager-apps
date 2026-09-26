import type { AgentSettings } from '@prisma/client'
import { languageName, MIXED_SCRIPT_RULES } from './language'
import { productContext, type Product } from './products'
import {
  compileQuestionnairePrompt,
  ensureMediaTokens,
  MAX_INTERVIEW_QUESTIONS,
  type QuestionnaireAnswer,
} from './questionnaire'

const MODEL = 'gpt-5.4-mini'
const SETUP_MODEL = 'gpt-5.6'

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

async function complete(system: string, user: string, maxTokens = 280, model = MODEL): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not configured')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
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
      'Write a concise WhatsApp support-agent brief the model will follow when answering customers.',
      'Write in the same language as the seller market (Darija/French/Arabic mix is fine).',
      'Include: what the store sells, variants and prices if given, and known shipping/COD/exchange/return facts. The agent does not create new orders.',
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

function summarizeAnswers(entries: QuestionnaireAnswer[]): string {
  return entries
    .map((entry) => {
      const media = entry.media.map((file) => `{media:${file.name}}`).join(', ')
      return [
        `Q: ${entry.question}`,
        entry.answer ? `A: ${entry.answer}` : '',
        media ? `Media: ${media}` : '',
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/** Compact product facts the setup model reads before role-playing a customer. */
export type ProductBrief = {
  title: string
  price?: number | string | null
  currency?: string | null
  description?: string | null
  variants?: string[]
}

export function sanitizeProductBriefs(raw: unknown, max = 40): ProductBrief[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string')
    .slice(0, max)
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        title: String(record.title).slice(0, 120),
        price: typeof record.price === 'number' || typeof record.price === 'string' ? record.price : null,
        currency: typeof record.currency === 'string' ? record.currency.slice(0, 8) : null,
        description: typeof record.description === 'string' ? record.description.replace(/\s+/g, ' ').slice(0, 400) : null,
        variants: Array.isArray(record.variants)
          ? record.variants
              .map((variant) => typeof variant === 'string'
                ? variant
                : variant && typeof variant === 'object' && typeof (variant as { title?: unknown }).title === 'string'
                  ? String((variant as { title: string; price?: unknown }).title)
                  : '')
              .filter(Boolean)
              .slice(0, 12)
          : [],
      }
    })
}

function describeProducts(products: ProductBrief[]): string {
  if (!products.length) return ''
  return products
    .map((product) => {
      const price = product.price != null && product.price !== '' ? ` — ${product.price} ${product.currency || ''}`.trimEnd() : ''
      const variants = product.variants?.length ? ` | variants: ${product.variants.join(', ')}` : ''
      const description = product.description ? `\n  ${product.description}` : ''
      return `- ${product.title}${price}${variants}${description}`
    })
    .join('\n')
}

export async function nextSellerInterviewQuestion(opts: {
  storeName?: string | null
  products?: ProductBrief[]
  language?: string | null
  common: QuestionnaireAnswer[]
  interview: QuestionnaireAnswer[]
}): Promise<{ done: boolean; question: string }> {
  if (opts.interview.length >= MAX_INTERVIEW_QUESTIONS) {
    return { done: true, question: '' }
  }

  const catalog = describeProducts(opts.products || [])
  const language = languageName(opts.language) || 'the language of the product data'
  const raw = await complete(
    [
      'You help a WhatsApp store seller prepare their AI agent. You role-play as a real customer of this store.',
      'First read the product list carefully (names, prices, variants, descriptions). Then ask the seller ONE question that a real customer would send on WhatsApp about these exact products or about buying them: sizes, colors, materials, compatibility, how to use, what is included, delivery time and cost to their city, payment (cash on delivery?), exchange or return, warranty, stock, discounts for several items.',
      'Prefer questions whose answer is NOT already visible in the product data. Mention the product by name when it makes the question concrete.',
      `Write the question in ${language}, in first person, like a customer. One short sentence, no lists, no preamble.`,
      opts.interview.length === 0
        ? 'This is the first question: you may open with a one-word greeting.'
        : 'This is NOT the first question: do not greet (no "salam", "hi", "bonjour"). Start directly with the question.',
      MIXED_SCRIPT_RULES,
      'Never ask something the seller already answered. Cover a different topic each time.',
      'When the important topics are covered, return done=true.',
      'Return JSON only: {"done":false,"question":"..."} or {"done":true,"question":""}.',
    ].join('\n'),
    [
      opts.storeName ? `Store: ${opts.storeName}` : '',
      catalog ? `Products the agent will sell:\n${catalog}` : 'No product data available. Ask general store questions (delivery, payment, returns, hours).',
      opts.common.length ? `Facts the seller already typed:\n${summarizeAnswers(opts.common)}` : '',
      `Questions already asked and answered:\n${summarizeAnswers(opts.interview) || '(none yet — start with the most important product question)'}`,
      `Questions asked so far: ${opts.interview.length}/${MAX_INTERVIEW_QUESTIONS}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    220,
    SETUP_MODEL,
  )

  let parsed: { done?: boolean; question?: string } = {}
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    parsed = match ? JSON.parse(match[0]) as { done?: boolean; question?: string } : {}
  } catch {
    parsed = { question: raw }
  }
  const question = String(parsed.question || '').replace(/^["“]|["”]$/g, '').trim()
  if (parsed.done === true || !question) return { done: true, question: '' }
  return { done: false, question }
}

export async function buildSellerAgentPrompt(opts: {
  tone?: string
  storeName?: string | null
  products?: ProductBrief[]
  language?: string | null
  entries: QuestionnaireAnswer[]
}): Promise<string> {
  const compiled = compileQuestionnairePrompt({
    tone: opts.tone,
    storeName: opts.storeName,
    entries: opts.entries,
  })
  const catalog = describeProducts((opts.products || []).slice(0, 16))
  const polished = await complete(
    [
      'Write the seller instructions prompt for a WhatsApp AI agent.',
      'The agent answers product and after-sales questions and helps customers change the variant on an existing order. It does not create new orders and never pushes a sale.',
      'For order variant changes, it must send the existing order carousel and update only after the customer clicks a carousel button, never from free text.',
      'Turn the seller answers below into a clear operating brief the agent can follow.',
      'If the seller skipped answers, write a safe default brief from the store and catalog only.',
      'Never invent prices, delivery times, cities, stock, discounts, or policies.',
      'If a media file is listed, keep that exact {media:filename} token and say when to send it.',
      'No markdown headings. 12–24 short lines. WhatsApp voice.',
      languageName(opts.language)
        ? `Write the brief in ${languageName(opts.language)} so the seller can read and edit it. Keep product names, codes, and {media:...} tokens exactly as given.`
        : '',
    ].filter(Boolean).join('\n'),
    [
      languageName(opts.language) ? `Store language (open conversations in it): ${languageName(opts.language)}` : '',
      opts.tone ? `Tone: ${opts.tone}` : '',
      opts.storeName ? `Store: ${opts.storeName}` : '',
      catalog ? `Products:\n${catalog}` : '',
      `Seller questionnaire / facts:\n${compiled}`,
      `Answered items: ${opts.entries.length}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    1400,
    SETUP_MODEL,
  )
  return ensureMediaTokens(polished, compiled)
}
