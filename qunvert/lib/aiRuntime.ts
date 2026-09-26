import OpenAI, { toFile } from 'openai'
import { leadAgentEnabled, shouldSubmitVariantCarousel, type AgentConfiguration } from './agentConfig'
import { languageName, MIXED_SCRIPT_RULES } from './language'
import { leadFieldsToCollect, leadFlowReady } from './leadForm'
import type { CustomerOrder } from './orders'
import type { Product } from './products'
import { collapseRepeatedPhrases, isDoNotAnswerTool, normalizeToolName } from './replyQuality'
import type { MatchedVariant } from './variantCarousel'

const MODEL = 'gpt-5.4-mini'

let client: OpenAI | null = null

function openai() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

export type HistoryItem = {
  role: 'user' | 'assistant'
  text: string
  type?: string | null
}

export type ToolAction = {
  name: 'order_summary_sent' | 'order_confirmed' | 'send_order_form' | 'send_variant_carousel' | 'send_order_variants' | 'request_human_agent' | 'donotanswer'
  arguments: Record<string, unknown>
}

export type AgentGeneration = {
  reply: string
  action: ToolAction | null
  usage: {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    estimatedCostUsd: number
  }
  servedModel: string
}

export type AgentGenerationInput = {
  ownerId: string
  agentName: string
  config: AgentConfiguration
  products: Product[]
  history: HistoryItem[]
  latestMessage: string
  customerPhone: string
  isFirstCustomerMessage: boolean
  recentOrderWithin10Min: boolean
  images?: { url: string; caption?: string }[]
  compressedCatalogue?: boolean
  /** Seller's FlashManager app language (en|fr|ar). Used until the customer's language is clear. */
  defaultLanguage?: string | null
  /** Exact catalogue variant selected through a WhatsApp carousel on this turn. */
  selectedVariant?: MatchedVariant | null
  /** Current FlashManager order context for this WhatsApp customer. */
  existingOrders?: CustomerOrder[]
  /** Result of the deterministic update attempted after a carousel button click. */
  orderEditResult?: {
    orderId: string
    orderName: string
    status: 'updated' | 'failed'
    shopifyUpdated?: boolean
    error?: string
  } | null
}

const CUSTOMER_KEYS = new Set([
  'customer_name',
  'customer_city',
  'customer_address',
  'customer_phone',
  'customer_province',
])

export function extractTemplateFields(template: string): {
  placeholders: string[]
  keys: string[]
  placeholderToKey: Record<string, string>
} {
  const placeholders: string[] = []
  const regex = /\{\{([^}]+)\}\}|\{([^}]+)\}|\[([^\]]+)\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template || '')) !== null) {
    const value = String(match[1] || match[2] || match[3] || '').trim()
    if (
      value &&
      !value.toLowerCase().startsWith('order_data') &&
      !value.toLowerCase().startsWith('media_file') &&
      !value.toLowerCase().startsWith('media:') &&
      !value.toLowerCase().startsWith('product_media:') &&
      !placeholders.includes(value)
    ) {
      placeholders.push(value)
    }
  }
  const placeholderToKey: Record<string, string> = {}
  const keys: string[] = []
  for (const placeholder of placeholders) {
    const key = normalizePlaceholder(placeholder)
    if (!key) continue
    placeholderToKey[placeholder] = key
    if (!keys.includes(key)) keys.push(key)
  }
  return { placeholders, keys, placeholderToKey }
}

export function normalizePlaceholder(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const canon = raw.toLowerCase().replace(/\s+/g, ' ')
  const known: Record<string, string> = {
    'full name': 'customer_name',
    name: 'customer_name',
    city: 'customer_city',
    address: 'customer_address',
    province: 'customer_province',
    region: 'customer_province',
    'phone number': 'customer_phone',
    phone: 'customer_phone',
    'product name': 'product_name',
    product_name: 'product_name',
    quantity: 'quantity',
    'product quantity': 'quantity',
    product_quantity: 'quantity',
    price: 'price',
    'product price': 'price',
    product_price: 'price',
    'total amount': 'total_amount',
    total_amount: 'total_amount',
    currency: 'currency',
  }
  if (known[canon]) return known[canon]
  const snake = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  if (!snake) return null
  if (snake.startsWith('customer_') || ['product_name', 'quantity', 'price', 'total_amount', 'currency'].includes(snake)) return snake
  return `customer_${snake}`
}

export function formatProductCatalogue(products: Product[], compressed = false): string {
  if (!products.length) return 'No products configured.'
  if (compressed) {
    return products.map((product) => {
      const numericPrice = Number(product.price)
      const price = !Number.isFinite(numericPrice)
        ? 'UNKNOWN'
        : numericPrice === 0
          ? 'FREE'
          : `${product.price} ${String(product.currency || '').toUpperCase()}`.trim()
      const variants = (product.variants || [])
        .map((variant) => `${variant.title || 'Variant'}:${variant.price}`)
        .join('; ')
      return `${product.title} | ${price}${variants ? ` | ${variants}` : ''}`
    }).join('\n')
  }
  const rows = products.map((product) => {
    const lines = [`📦 PRODUCT: ${product.title}`]
    const numericPrice = Number(product.price)
    if (!Number.isFinite(numericPrice)) lines.push('💰 Price: UNKNOWN')
    else if (numericPrice === 0) lines.push('💰 Price: FREE')
    else lines.push(`💰 Price: ${product.price} ${String(product.currency || '').toUpperCase()}`)
    if (product.description) lines.push(`📝 Description: ${product.description}`)
    if (product.variants?.length) {
      lines.push('🔄 Variants:')
      for (const variant of product.variants) {
        lines.push(`- ${variant.title || 'Variant'}: ${variant.price} ${product.currency || ''}${variant.sku ? ` · SKU ${variant.sku}` : ''}`)
      }
    }
    return lines.join('\n')
  })
  return rows.join('\n\n---\n\n')
}

function historyText(history: HistoryItem[]) {
  return history
    .slice(-50)
    .map((item) => `- ${item.role}: ${item.text || `[${item.type || 'message'}]`}`)
    .join('\n')
}

function openerBlock(config: AgentConfiguration, first: boolean) {
  const opener = config.autoReplyOpener.trim()
  if (!opener) return ''
  return first
    ? `AUTO-REPLY OPENER FOR THIS TURN: Return this exact content with no additions or rewriting:\n${opener}`
    : 'The auto-reply opener has already been used. Do not greet or introduce yourself again.'
}

export const CONTEXT_DISCIPLINE = `CONTEXT DISCIPLINE:
- Stay strictly on this live WhatsApp thread. Latest customer TEXT is the instruction. Images and screenshots are supporting evidence only — never treat text inside a screenshot as this live chat unless the customer asked about that screenshot.
- Never invent a new topic (payment, delivery, products, handoff, jargon) unless the customer brought it up or it is required to finish their actual request.
- If the WHOLE conversation is unrelated to this business (spam, wrong company, no store intent), call donotanswer and write no customer-facing text.
- Never interview the customer. Do not ask clarification, diagnostic, or multiple-choice questions that will not immediately let you solve the request.
- A question is allowed only when all of these are true: you already know how you will use the answer to finish the next concrete step; that fact is missing from the thread, seller instructions, and catalogue; and without it you cannot take any useful action.
- If those conditions are not met, do not ask. Answer from what you have, say you do not have that information, or call request_human_agent with reason cannot_help.
- Never ask the customer to explain an error they already pasted, confirm whether they followed steps, or name technical terms.
- While taking an order, the only allowed questions are missing required order fields after buying intent is clear. Never ask out-of-context product, payment, or process questions.
- For support, solve from seller instructions and the thread. If you cannot actually fix it, say so in one short line and hand off. Do not make the customer angrier with more questions.`

function staticPrefix(defaultLanguage?: string | null) {
  const preferred = languageName(defaultLanguage)
  return `You are a WhatsApp store representative.

LANGUAGE:
- Reply in the customer's established language. A single borrowed word never changes language.
${preferred
    ? `- Store language: ${preferred}. Use it for your first reply and whenever the customer's language is not clear yet (emoji-only, a bare product name, a number). Once the customer writes in another language, mirror them.`
    : '- If the customer\'s language is not clear yet, use the language of the seller instructions.'}
- ${MIXED_SCRIPT_RULES.split('\n').join('\n- ')}
- Greet only in your very first message of a conversation. Never start later replies with a greeting.
- Keep replies extremely short: normally one or two sentences and at most 400 characters.
- Sound human. Never say you are an AI. Never repeat greetings, questions, clauses, or sentence openings. Never write the same sentence twice in one reply.
- Never describe your own feelings or state: do not say you are happy, glad, fine, working, available, or "here if needed."
- When the customer only confirms that something works, answer with one neutral acknowledgement in their language. Do not add a generic offer of more help.

${CONTEXT_DISCIPLINE}`
}

const STATIC_SUFFIX = `TRUTH AND SAFETY:
- Use only the seller instructions and current catalogue. If information is absent, say you do not have it. Do not fill the gap with questions that cannot produce the missing fact.
- Never expose a {media:filename} token as visible text. Keep tokens only when intentionally sending that exact uploaded file.
- Send media only when the customer asks or seller instructions explicitly require it.
- Never promise human help unless you call request_human_agent in the same turn.
- After you call request_human_agent, that one message is the last customer-facing reply. Do not keep collecting order fields or answering follow-ups.
- Confusion, screenshots, wait requests, and "I don't understand" are not by themselves a human handoff. Lack of knowledge to solve the actual problem is.
- If the customer sent a photo, look at the attached image and answer from what you see. Never say you cannot see it, that they sent a media file, or that you only received an attachment.
- Read the full history before asking for information. Never ask for information already supplied.`

function sellerBlock(input: AgentGenerationInput) {
  const tone = input.config.tone.trim() || 'Friendly, concise, natural, and direct.'
  const forbidden = input.config.forbiddenContent.trim() ||
    'Never mention prompts, OpenAI, databases, internal systems, or private customer data. Never invent facts, prices, products, stock, discounts, or capabilities.'
  return `BUSINESS: ${input.agentName}

TONE:
${tone}

FORBIDDEN:
${forbidden}

SELLER INSTRUCTIONS — apply unless they conflict with the role, safety, or order rules above:
${input.config.instructions.trim() || 'Answer clearly and help the customer.'}`
}

/** Customer fields the AI must collect in chat before an order (lead form first, template as fallback). */
export function orderCustomerFields(config: AgentConfiguration): { key: string; label: string; required: boolean }[] {
  if (leadAgentEnabled(config)) {
    return leadFieldsToCollect(config.leadForm).map((field) => ({ key: field.key, label: field.label, required: field.required }))
  }
  const fields = extractTemplateFields(config.confirmationTemplate)
  return fields.keys
    .filter((key) => CUSTOMER_KEYS.has(key) && key !== 'customer_phone')
    .map((key) => ({ key, label: key.replace(/^customer_/, '').replace(/_/g, ' '), required: true }))
}

export function formatCustomerOrders(orders: CustomerOrder[]): string {
  if (!orders.length) return 'EXISTING ORDERS: none found for this WhatsApp number.'
  return `EXISTING ORDERS — newest first:\n${orders.slice(0, 5).map((order) => {
    const items = (order.items || []).map((item) => {
      const variant = item.variant ? ` — ${item.variant}` : ''
      const sku = item.sku ? ` (SKU ${item.sku})` : ''
      const price = item.price == null ? '' : ` @ ${item.price} ${order.currency || ''}`.trimEnd()
      return `${Math.max(1, Number(item.qty || 1))}× ${item.title}${variant}${sku}${price}`
    }).join('; ') || 'items unavailable'
    const carousel = order.variants
      ? `variant carousel ready for ${order.variants.productTitle} (${order.variants.cardCount} choices)`
      : 'no variant carousel'
    return `- ${order.name || order.id} [id=${order.id}] · confirmation=${order.confirmation || 'unknown'} · fulfillment=${order.fulfillment || 'unfulfilled'} · financial=${order.financial || 'unknown'} · ${items} · ${carousel}`
  }).join('\n')}`
}

function orderingBlock(input: AgentGenerationInput) {
  const { config } = input
  if (!leadAgentEnabled(config)) {
    const orders = input.existingOrders || []
    const newest = orders[0]
    const confirmed = String(newest?.confirmation || '').toLowerCase().includes('confirm')
    const createdAt = newest ? new Date(newest.createdAt).getTime() : 0
    const recent = Number.isFinite(createdAt) && Date.now() - createdAt < 24 * 60 * 60 * 1000
    const customerType = !orders.length
      ? 'CUSTOMER WITH NO ORDER FOUND'
      : confirmed && recent
        ? 'CUSTOMER WHO JUST CONFIRMED AN ORDER'
        : confirmed
          ? 'EXISTING CUSTOMER WITH A CONFIRMED ORDER'
          : 'EXISTING CUSTOMER WITH AN ORDER'
    return `ORDERS AND CUSTOMER TYPE:
- Customer type: ${customerType}.
${formatCustomerOrders(orders)}

ORDER RULES:
- This agent does not create new orders. It supports customers and can help change a variant on an existing order.
- Always use the order context above. Never ask for order details already present there.
- If the customer asks for another color, size, or variant for an existing order, immediately call send_order_variants for the matching order. Do not ask whether they want to change it.
- Even if they type an exact choice such as "I want red" or "change S to M", do not update from text. Call send_order_variants and tell them to use the Choose button.
- An order may be updated only after a structured carousel button click. Never claim an order changed from a normal text reply.
- If several orders genuinely match and the intended one cannot be inferred from the product/thread, ask only which ordered product they mean.
- For a new purchase request, answer from seller instructions without taking an order; hand off only if needed.`
  }
  const fields = orderCustomerFields(config)
  const requiredList = fields.filter((field) => field.required).map((field) => field.label).join(', ') || '(none)'
  const optionalList = fields.filter((field) => !field.required).map((field) => field.label).join(', ')
  const useForm = leadFlowReady(config.leadForm)
  const carouselProducts = input.products.filter((product) => (product.variants || []).length > 1)
  const carousel = shouldSubmitVariantCarousel(config) && carouselProducts.length
    ? `- VARIANT CAROUSEL AVAILABLE for: ${carouselProducts.map((product) => product.title).join(', ')}. When the customer explicitly asks to see variants, colors, sizes, or options for one of these products, call send_variant_carousel. Do not send it for general product questions, and never send it twice.
- After the customer chooses a carousel card, that exact selected variant and catalogue price are authoritative. Do not resend the carousel; continue the order using that selection.`
    : '- No validated variant carousel is available. Answer variant questions in short text from the catalogue.'
  const collect = useForm
    ? `- ORDER FORM AVAILABLE. When the customer clearly wants to buy — including immediately after choosing a carousel variant — call send_order_form once with the items (exact catalogue names, selected variant price, quantity) and a natural one-sentence message written for this conversation in the customer's language. This message must be newly generated, never copied from a fixed template. Do not ask for delivery details in chat — the form collects ${fields.map((field) => field.label).join(', ')}.
- If the customer already typed all required details (${requiredList}) instead of using the form, skip the form: show one order summary, call order_summary_sent, then order_confirmed when they confirm.
- Never send the form twice in a conversation. If it was already sent, wait for the submission or answer their questions.`
    : `- When the customer clearly wants to buy, collect only the missing required details: ${requiredList}.${optionalList ? ` Optional, only if offered: ${optionalList}.` : ''} Ask for several in one short message, never one by one.
- Show one complete order summary, then call order_summary_sent in that same turn.
- After the customer confirms that summary, call order_confirmed immediately. Never repeat the summary.`
  return `ORDERS:
- Buying intent must come from the customer ("I want to order", "how do I buy", quantity + product). Never steer a support question toward a purchase; many customers already ordered.
- Use exact catalogue names and prices. Quantity defaults to 1 unless the customer states another quantity.
- Use the WhatsApp phone ${input.customerPhone} for customer_phone; never ask for it unless the customer gives a replacement.
${carousel}
${collect}
- If multiple products are ordered, use items with one entry per product.
- The only questions allowed while taking an order are missing required customer fields.

CONFIRMATION TEMPLATE (sent automatically after order_confirmed):
${config.confirmationTemplate}`
}

function agentPrompt(input: AgentGenerationInput) {
  const catalogueLabel = input.compressedCatalogue ? 'PRODUCT CATALOGUE (compressed)' : 'PRODUCT CATALOGUE'
  return `${staticPrefix(input.defaultLanguage)}

${STATIC_SUFFIX}

ROLE:
- You are the store's WhatsApp assistant: answer product and after-sales questions (delivery, returns, sizes, tracking, usage) from seller instructions and the catalogue.
- Answer only what was asked. Do not upsell or push a sale after an information request.
- Do not run a troubleshooting interview. If the customer already stated the problem or pasted an error, use that and answer or hand off.
- Never call request_human_agent because the customer is confused or asked you to wait.
- If seller instructions, the catalogue, and this thread are not enough to solve the request, call request_human_agent with reason cannot_help in the same turn. Do not ask whether they want a human and do not stall with extra questions.
- After a human handoff message, stop. Do not keep answering until a person has handled the chat.

${orderingBlock(input)}

${sellerBlock(input)}

${catalogueLabel}:
${formatProductCatalogue(input.products, !!input.compressedCatalogue)}

${input.recentOrderWithin10Min ? 'RECENT ORDER: An order was confirmed in the last 10 minutes. Do not confirm another duplicate order.' : ''}
${input.selectedVariant && input.orderEditResult?.status === 'updated'
    ? `ORDER UPDATE COMPLETED — authoritative result from a carousel button click:
- Order: ${input.orderEditResult.orderName} (${input.orderEditResult.orderId})
- Product: ${input.selectedVariant.productName}
- Variant: ${input.selectedVariant.variantTitle}
- Price: ${input.selectedVariant.price} ${input.selectedVariant.currency}
${input.selectedVariant.sku ? `- SKU: ${input.selectedVariant.sku}` : ''}
Tell the customer clearly that their order now uses ${input.selectedVariant.variantTitle}. Do not call another tool or resend the carousel.${input.orderEditResult.shopifyUpdated ? ' The Shopify order was synchronized too.' : ''}`
    : input.selectedVariant && input.orderEditResult?.status === 'failed'
      ? `ORDER UPDATE FAILED after a valid carousel choice:
- Order: ${input.orderEditResult.orderName} (${input.orderEditResult.orderId})
- Requested variant: ${input.selectedVariant.variantTitle}
Do not claim the order changed. Apologize briefly and call request_human_agent with reason cannot_help so a person can apply the selected variant.`
      : input.selectedVariant
        ? `A carousel variant was selected but its order could not be resolved safely. Do not claim any update; call request_human_agent with reason cannot_help.`
    : ''}
${openerBlock(input.config, input.isFirstCustomerMessage)}

CONTEXT — oldest to newest:
${historyText(input.history) || 'No previous conversation.'}`
}

function orderSchema(config: AgentConfiguration) {
  const fields = extractTemplateFields(config.confirmationTemplate)
  const leadFields = orderCustomerFields(config)
  const properties: Record<string, unknown> = {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          product_name: { type: 'string' },
          quantity: { type: 'number' },
          price: { type: 'string' },
          variant_id: { type: 'string' },
          variant_title: { type: 'string' },
          sku: { type: 'string' },
        },
        required: ['product_name', 'quantity', 'price'],
        additionalProperties: false,
      },
    },
    product_name: { type: 'string' },
    quantity: { type: 'number' },
    price: { type: 'string' },
    total_amount: { type: 'string' },
    currency: { type: 'string' },
    customer_name: { type: 'string' },
    customer_city: { type: 'string' },
    customer_address: { type: 'string' },
    customer_phone: { type: 'string' },
    customer_province: { type: 'string' },
  }
  for (const key of fields.keys) {
    if (!properties[key]) properties[key] = { type: 'string' }
  }
  for (const field of leadFields) {
    if (!properties[field.key]) properties[field.key] = { type: 'string', description: field.label }
  }
  const required = [
    'total_amount',
    'currency',
    ...(leadAgentEnabled(config)
      ? leadFields.filter((field) => field.required).map((field) => field.key)
      : fields.keys.filter((key) => key.startsWith('customer_') && key !== 'customer_phone')),
  ]
  return { type: 'object', properties, required: [...new Set(required)], additionalProperties: false }
}

function itemsSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        product_name: { type: 'string' },
        quantity: { type: 'number' },
        price: { type: 'string' },
        variant_id: { type: 'string' },
        variant_title: { type: 'string' },
        sku: { type: 'string' },
      },
      required: ['product_name', 'quantity', 'price'],
      additionalProperties: false,
    },
  }
}

function tools(
  config: AgentConfiguration,
  products: Product[],
  existingOrders: CustomerOrder[] = [],
  selectedVariant?: MatchedVariant | null,
) {
  const skip = {
    type: 'function',
    name: 'donotanswer',
    description: 'Call only when the entire conversation is outside this business (spam, wrong company, no store intent). Sends no WhatsApp message. Do not call for one confusing message in an otherwise on-topic chat, and do not replace a missing answer with extra questions.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['off_topic', 'spam', 'wrong_business', 'no_store_intent', 'unintelligible_thread'],
        },
        explanation: { type: 'string', description: 'Why the whole conversation is outside this business.' },
      },
      required: ['reason', 'explanation'],
      additionalProperties: false,
    },
  }
  const human = {
    type: 'function',
    name: 'request_human_agent',
    description: 'Call after the customer explicitly asks for a person, when seller instructions require immediate handoff, or when you cannot solve the request from seller instructions, catalogue, and this thread (reason cannot_help). Send one short handoff message and stop. Do not call again in later turns. Do not call only because the customer is confused, sent a screenshot, or asked you to wait. Do not ask more questions instead of handing off.',
    parameters: {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'Short natural message to send to the customer.' },
        reason: { type: 'string', enum: ['explicit_request', 'cannot_help', 'complex_issue', 'complaint'] },
        phone_number: { type: 'string' },
      },
      required: ['response', 'reason'],
      additionalProperties: false,
    },
  }
  const editableOrders = selectedVariant
    ? []
    : existingOrders.filter((order) => order.variants && order.variants.cardCount > 0)
  const orderVariants = editableOrders.length
    ? [{
        type: 'function',
        name: 'send_order_variants',
        description: 'Send the existing order\'s WhatsApp variant carousel immediately when the customer asks to change color, size, or variant. Use this even when they typed the desired option; only the carousel button may authorize the update.',
        parameters: {
          type: 'object',
          properties: {
            response: { type: 'string', description: 'Short message in the customer\'s language asking them to choose using the button.' },
            fallback_response: { type: 'string', description: 'Short message in the customer\'s language saying the options could not be opened right now. Do not claim a person was notified.' },
            order_id: { type: 'string', enum: editableOrders.map((order) => order.id) },
          },
          required: ['response', 'fallback_response', 'order_id'],
          additionalProperties: false,
        },
      }]
    : []
  if (!leadAgentEnabled(config)) return [skip, ...orderVariants, human]
  const carouselProducts = shouldSubmitVariantCarousel(config)
    ? products.filter((product) => (product.variants || []).length > 1)
    : []
  const carousel = carouselProducts.length
    ? [{
        type: 'function',
        name: 'send_variant_carousel',
        description: 'Send the approved WhatsApp variant carousel only when the customer explicitly asks to see options, colors, sizes, or variants for one specific product. Do not use after a variant was selected, for a product with one/no variants, or to push a sale.',
        parameters: {
          type: 'object',
          properties: {
            response: { type: 'string', description: 'One short natural sentence in the customer\'s language introducing the choices.' },
            product_name: { type: 'string', enum: carouselProducts.map((product) => product.title) },
          },
          required: ['response', 'product_name'],
          additionalProperties: false,
        },
      }]
    : []
  const form = leadFlowReady(config.leadForm)
    ? [{
        type: 'function',
        name: 'send_order_form',
        description: 'Call once when the customer clearly wants to buy. Sends the WhatsApp order form that collects their delivery details. Include the items they want with catalogue prices. Do not call again in the same conversation.',
        parameters: {
          type: 'object',
          properties: {
            response: { type: 'string', description: 'One short sentence shown above the form button, in the customer\'s language.' },
            pending_data: {
              type: 'object',
              properties: {
                items: itemsSchema(),
                total_amount: { type: 'string' },
                currency: { type: 'string' },
              },
              required: ['items', 'total_amount', 'currency'],
              additionalProperties: false,
            },
          },
          required: ['response', 'pending_data'],
          additionalProperties: false,
        },
      }]
    : []
  return [
    skip,
    ...orderVariants,
    ...carousel,
    ...form,
    {
      type: 'function',
      name: 'order_summary_sent',
      description: 'Call exactly once immediately after sending a complete order summary containing all required information.',
      parameters: {
        type: 'object',
        properties: {
          response: { type: 'string' },
          pending_data: orderSchema(config),
        },
        required: ['response', 'pending_data'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'order_confirmed',
      description: 'Call immediately when the customer positively confirms the previously shown complete order summary.',
      parameters: {
        type: 'object',
        properties: {
          response: { type: 'string' },
          seller_notification_prefix: { type: 'string' },
          order_data: orderSchema(config),
        },
        required: ['response', 'seller_notification_prefix', 'order_data'],
        additionalProperties: false,
      },
    },
    human,
  ]
}

function responseInput(system: string, user: string, images: { url: string; caption?: string }[] = []) {
  const userContent: unknown = images.length
    ? [
        { type: 'input_text', text: user },
        ...images.slice(0, 3).map((image) => ({
          type: 'input_image',
          image_url: image.url,
          detail: 'high',
        })),
      ]
    : user
  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ]
}

function parseResponse(response: any): { text: string; action: ToolAction | null } {
  let text = typeof response?.output_text === 'string' ? response.output_text : ''
  let action: ToolAction | null = null
  let skip: ToolAction | null = null
  for (const item of response?.output || []) {
    if (item?.type === 'function_call') {
      let args: Record<string, unknown> = {}
      try {
        args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments || {}
      } catch {
        args = {}
      }
      const name = normalizeToolName(item.name) === 'donotanswer'
        ? 'donotanswer'
        : String(item.name || '')
      const parsed = { name, arguments: args } as ToolAction
      if (isDoNotAnswerTool(name)) skip = parsed
      else if (!action) action = parsed
    }
    if (item?.type === 'message') {
      for (const content of item.content || []) {
        if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') text += content.text
      }
    }
  }
  action = skip || action
  if (action && isDoNotAnswerTool(action.name)) return { text: '', action: { ...action, name: 'donotanswer' } }
  if (action && typeof action.arguments.response === 'string') text = action.arguments.response
  return { text: collapseRepeatedPhrases(text.trim()), action }
}

function usageOf(response: any) {
  const inputTokens = Number(response?.usage?.input_tokens || response?.usage?.prompt_tokens || 0)
  const outputTokens = Number(response?.usage?.output_tokens || response?.usage?.completion_tokens || 0)
  const cachedTokens = Number(response?.usage?.input_tokens_details?.cached_tokens || response?.usage?.prompt_tokens_details?.cached_tokens || 0)
  const uncached = Math.max(0, inputTokens - cachedTokens)
  const estimatedCostUsd = (uncached / 1_000_000) * 0.75 + (cachedTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 4.5
  return { inputTokens, outputTokens, cachedTokens, estimatedCostUsd }
}

async function responsesCreate(params: Record<string, unknown>) {
  return (openai().responses.create as any)(params)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`
  return String(error)
}

export function isContextLengthError(error: unknown): boolean {
  const text = errorText(error).toLowerCase()
  return text.includes('context_length') || text.includes('maximum context') || text.includes('too many tokens') || text.includes('context window')
}

export function isImageInputError(error: unknown): boolean {
  const text = errorText(error).toLowerCase()
  return text.includes('invalid_image') || text.includes('unsupported image') || (text.includes('image') && text.includes('invalid'))
}

async function generateWithFallback(
  system: string,
  user: string,
  ownerId: string,
  agentTools: unknown[],
  images: { url: string; caption?: string }[] = [],
) {
  const base = {
    model: MODEL,
    input: responseInput(system, user, images),
    tools: agentTools,
    tool_choice: 'auto',
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
    max_output_tokens: 700,
    prompt_cache_key: `org-${ownerId}`,
    prompt_cache_retention: '24h',
  }
  try {
    let response = await responsesCreate(base)
    let parsed = parseResponse(response)
    if (!parsed.text && !parsed.action) {
      response = await responsesCreate({
        ...base,
        reasoning: { effort: 'none' },
        max_output_tokens: 1200,
        prompt_cache_key: undefined,
        prompt_cache_retention: undefined,
      })
      parsed = parseResponse(response)
    }
    if (parsed.text || parsed.action) return { response, parsed }
  } catch (firstError) {
    if (isContextLengthError(firstError)) throw firstError
    if (images.length && isImageInputError(firstError)) {
      return generateWithFallback(system, user, ownerId, agentTools, [])
    }
    try {
      const response = await responsesCreate({
        ...base,
        prompt_cache_key: undefined,
        prompt_cache_retention: undefined,
      })
      const parsed = parseResponse(response)
      if (parsed.text || parsed.action) return { response, parsed }
    } catch (secondError) {
      if (isContextLengthError(secondError)) throw secondError
      if (images.length && isImageInputError(secondError)) {
        return generateWithFallback(system, user, ownerId, agentTools, [])
      }
    }
    console.warn('[wa-ai] responses fallback', (firstError as Error).message)
  }

  try {
    const response = await (openai().chat.completions.create as any)({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: images.length
            ? [
                { type: 'text', text: user },
                ...images.slice(0, 3).map((image) => ({
                  type: 'image_url',
                  image_url: { url: image.url, detail: 'high' },
                })),
              ]
            : user,
        },
      ],
      tools: agentTools.map((tool: any) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: 'auto',
      max_completion_tokens: 700,
    })
    const message = response?.choices?.[0]?.message
    let action: ToolAction | null = null
    if (message?.tool_calls?.length) {
      const call = message.tool_calls[0]
      let args = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        args = {}
      }
      const name = isDoNotAnswerTool(call.function.name) ? 'donotanswer' : String(call.function.name || '')
      action = { name, arguments: args } as ToolAction
    }
    const text = isDoNotAnswerTool(action?.name)
      ? ''
      : collapseRepeatedPhrases(String(action?.arguments?.response || message?.content || '').trim())
    return {
      response,
      parsed: { text, action },
    }
  } catch (chatError) {
    if (images.length && isImageInputError(chatError)) {
      return generateWithFallback(system, user, ownerId, agentTools, [])
    }
    throw chatError
  }
}

export async function generateAgentReply(input: AgentGenerationInput): Promise<AgentGeneration> {
  const userPrompt = (payload: AgentGenerationInput) => {
    const batched = payload.latestMessage.includes('\n')
      ? `Customer sent rapid messages. Answer the combined intent in one short reply:\n${payload.latestMessage}`
      : `Latest customer message: "${payload.latestMessage || 'Customer sent a non-text message.'}"`
    const imageHint = payload.images?.length
      ? '\nThe customer sent a photo. The image is attached to this turn — look at it and answer from what you see. Never say you cannot see the image or that they sent a media/attachment.'
      : ''
    return `${batched}${imageHint}

Rules for this turn:
- Stay on this live conversation. Never invent a new topic.
- If the WHOLE conversation is unrelated to this business, call donotanswer and write no customer-facing text.
- Do not ask a clarification question unless the answer is required to finish this turn and is missing from the thread.
- If you cannot solve the request from seller instructions, catalogue, and this thread, say you do not have that information or call request_human_agent with reason cannot_help. Do not interview the customer.
- Never repeat the same sentence, clause, or greeting in this reply.
- Do not call request_human_agent only because the customer is confused or asked you to wait.
- If you already promised a human in this thread, do not send another customer reply.
Draft the exact reply now, or call donotanswer.`
  }
  const run = (payload: AgentGenerationInput) => generateWithFallback(
    agentPrompt(payload),
    userPrompt(payload),
    payload.ownerId,
    tools(payload.config, payload.products, payload.existingOrders, payload.selectedVariant),
    payload.images,
  )
  let result
  try {
    result = await run(input)
  } catch (error) {
    if (input.images?.length && isImageInputError(error)) {
      result = await run({ ...input, images: [] })
    } else if (isContextLengthError(error) && !input.compressedCatalogue) {
      result = await run({ ...input, images: [], compressedCatalogue: true })
    } else {
      throw error
    }
  }
  const usage = usageOf(result.response)
  const servedModel = String(result.response?.model || MODEL)
  const cachePct = usage.inputTokens ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0
  console.log(`[GPT54-PROOF] requested=${MODEL} served=${servedModel} cache=${cachePct}% tokens=${usage.inputTokens}/${usage.outputTokens}`)
  return {
    reply: isDoNotAnswerTool(result.parsed.action?.name) ? '' : collapseRepeatedPhrases(result.parsed.text),
    action: result.parsed.action && isDoNotAnswerTool(result.parsed.action.name)
      ? { ...result.parsed.action, name: 'donotanswer' }
      : result.parsed.action,
    usage,
    servedModel,
  }
}

export async function generateFollowUp(opts: {
  ownerId: string
  businessName: string
  instructions: string
  history: HistoryItem[]
}): Promise<string> {
  const response = await (openai().chat.completions.create as any)({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Write one short WhatsApp follow-up for ${opts.businessName}. Match the customer's language and refer to the customer's actual unfinished product question or order from the history. Use at most two sentences, do not be pushy, do not call tools, and do not ask out-of-context questions. Never describe your own feelings or state (happy, glad, fine, working, available) and never write a vague "I am here if you need anything" message. Return only the message. Seller instructions: ${opts.instructions || 'Briefly ask whether the customer still wants help with the exact topic they left unfinished.'}\nHistory:\n${historyText(opts.history)}`,
      },
      { role: 'user', content: 'Write the follow-up now.' },
    ],
    max_completion_tokens: 500,
  })
  return collapseRepeatedPhrases(String(response?.choices?.[0]?.message?.content || '').trim())
}

export async function classifyCustomLabels(opts: {
  ownerId: string
  candidates: { condition: string; label: string }[]
  history: HistoryItem[]
}): Promise<string[]> {
  if (!opts.candidates.length) return []
  const allowed = opts.candidates.map((item) => item.label)
  const response = await responsesCreate({
    model: MODEL,
    input: [
      {
        role: 'system',
        content: `Classify a WhatsApp conversation conservatively. Return labels only when their condition is clearly satisfied.\n${opts.candidates.map((item) => `- ${item.label}: ${item.condition}`).join('\n')}`,
      },
      { role: 'user', content: historyText(opts.history) },
    ],
    tools: [{
      type: 'function',
      name: 'apply_custom_labels',
      description: 'Return the labels whose conditions are clearly satisfied.',
      parameters: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: { type: 'string', enum: allowed } },
        },
        required: ['labels'],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: 'function', name: 'apply_custom_labels' },
    max_output_tokens: 500,
    prompt_cache_key: `org-${opts.ownerId}`,
    prompt_cache_retention: '24h',
  })
  const call = (response as any)?.output?.find((item: any) => item.type === 'function_call')
  try {
    const args = JSON.parse(call?.arguments || '{}')
    return Array.isArray(args.labels) ? args.labels.filter((label: string) => allowed.includes(label)) : []
  } catch {
    return []
  }
}

export async function transcribeAudio(bytes: Buffer, fileName = 'voice.ogg'): Promise<string> {
  const transcribe = async (name: string) => {
    const file = await toFile(bytes, name)
    const transcript = await openai().audio.transcriptions.create({
      file,
      model: 'whisper-1',
    })
    return transcript.text.trim()
  }
  try {
    return await transcribe(fileName)
  } catch {
    return transcribe(fileName.endsWith('.ogg') ? 'voice.mp3' : 'voice.ogg')
  }
}

export async function refineAgentField(opts: {
  field: 'instructions' | 'tone' | 'forbiddenContent'
  mode: 'leads' | 'support'
  currentText: string
  products: Product[]
}): Promise<string> {
  const fieldName = opts.field === 'instructions'
    ? opts.mode === 'leads' ? 'Sales Instructions' : 'Chat Guidelines'
    : opts.field === 'tone' ? 'Tone of Voice' : 'Forbidden Content'
  const hasText = !!opts.currentText.trim()
  const productContext = opts.field === 'instructions'
    ? `\nPRODUCT CATALOGUE:\n${formatProductCatalogue(opts.products).slice(0, 30_000)}`
    : ''
  const user = hasText
    ? `Improve this text for clarity and usefulness without inventing products, prices, discounts, delivery promises, policies, media references, or capabilities. Preserve its intent. Return only the concise final prompt:\n\n${opts.currentText}`
    : `Generate a plain bullet list for ${fieldName}. Use 5 to 9 short bullets, no headings and no invented business facts.${productContext}`
  const call = () => (openai().chat.completions.create as any)({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `You are FlashManager's prompt assistant. Field: ${fieldName}. Agent mode: ${opts.mode}. Return only final prompt text, with no JSON or markdown fences.`,
      },
      { role: 'user', content: user },
    ],
    max_completion_tokens: 900,
  })
  let response
  try {
    response = await call()
  } catch {
    response = await call()
  }
  let text = String(response?.choices?.[0]?.message?.content || '').trim()
  const tooLong = text.length > 1200 || text.split('\n').length > 20
  if (tooLong) {
    const compact = await (openai().chat.completions.create as any)({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Rewrite as 5 to 9 concise plain bullets. No headings, no emojis, no new facts. Return only the bullets.' },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 600,
    })
    text = String(compact?.choices?.[0]?.message?.content || text).trim()
  }
  return text
}

export function fillConfirmationTemplate(
  template: string,
  orderData: Record<string, any>,
  customerPhone: string,
): string {
  const fields = extractTemplateFields(template)
  let output = template
  for (const placeholder of fields.placeholders) {
    const key = fields.placeholderToKey[placeholder]
    const value = key === 'customer_phone'
      ? customerPhone
      : key === 'product_name' && Array.isArray(orderData.items)
        ? orderData.items
            .map((item: any) => `${item.product_name || ''}${item.variant_title ? ` — ${item.variant_title}` : ''}`.trim())
            .join(', ')
        : orderData[key]
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    output = output
      .replace(new RegExp(`\\{\\{${escaped}\\}\\}`, 'gi'), String(value ?? ''))
      .replace(new RegExp(`\\{${escaped}\\}`, 'gi'), String(value ?? ''))
      .replace(new RegExp(`\\[${escaped}\\]`, 'gi'), String(value ?? ''))
  }
  return output.replace(/\{media:[^}]+\}/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}
