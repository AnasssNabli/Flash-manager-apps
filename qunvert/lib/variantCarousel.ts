import { gwResult } from './fm'
import type { AgentOrderData, CustomerOrder, OrderItem } from './orders'
import type { Product } from './products'
import type { SendResult, ThreadMessage } from './wa'

export type VariantChoice = {
  label: string
  index: number
  contextKey: string | null
}

export type MatchedVariant = {
  productId: string
  productName: string
  currency: string
  variantId: string | null
  variantTitle: string
  sku: string | null
  price: string
}

function clean(value: unknown) {
  return String(value || '').trim()
}

function normalized(value: unknown) {
  return clean(value).toLocaleLowerCase().replace(/\s+/g, ' ')
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Parse Meta button replies produced by FlashManager's `fmcar:*` carousel buttons. */
export function parseVariantChoice(message: ThreadMessage): VariantChoice | null {
  const metadata = nestedRecord(message.metadata)
  const interactive = nestedRecord(metadata.interactive)
  const buttonReply = nestedRecord(interactive.button_reply)
  const button = nestedRecord(metadata.button)
  const payload = clean(
    metadata.button_payload ||
    buttonReply.id ||
    button.payload ||
    metadata.choice_payload ||
    metadata.choice_label,
  )
  if (payload.startsWith('fmcar:')) {
    const parts = payload.split(':')
    const index = Number(parts[2])
    const label = clean(parts.slice(3).join(':')) || clean(buttonReply.title || metadata.choice_label)
    if (!label) return null
    return {
      label,
      index: Number.isFinite(index) ? index : -1,
      contextKey: clean(parts[1]) || null,
    }
  }
  const label = clean(metadata.choice_label || buttonReply.title)
  return label ? { label, index: -1, contextKey: null } : null
}

/** Resolve a button label to one exact catalogue variant; ambiguous labels are rejected. */
export function matchVariantChoice(products: Product[], choice: VariantChoice): MatchedVariant | null {
  const context = normalized(choice.contextKey)
  const scoped = context
    ? products.filter((product) =>
        normalized(product.id) === context ||
        normalized(product.title) === context ||
        context.includes(normalized(product.id)),
      )
    : products
  const pool = scoped.length ? scoped : products
  const exact: MatchedVariant[] = []

  for (const product of pool) {
    const variants = product.variants || []
    for (const [index, variant] of variants.entries()) {
      const title = clean(variant.title)
      if (!title) continue
      const labelMatches =
        normalized(title) === normalized(choice.label) ||
        normalized(`${product.title} ${title}`) === normalized(choice.label)
      const indexMatches = choice.index >= 0 && index === choice.index && pool.length === 1
      if (!labelMatches && !indexMatches) continue
      exact.push({
        productId: product.id,
        productName: product.title,
        currency: product.currency,
        variantId: variant.id,
        variantTitle: title,
        sku: variant.sku,
        price: String(variant.price),
      })
    }
  }
  return exact.length === 1 ? exact[0] : null
}

/** Resolve a choice only against products present in the referenced existing order. */
export function matchOrderVariantChoice(
  products: Product[],
  order: CustomerOrder,
  choice: VariantChoice,
): MatchedVariant | null {
  const orderTitles = new Set(
    [
      order.variants?.productTitle,
      ...(order.items || []).map((item) => item.title),
    ]
      .map(normalized)
      .filter(Boolean),
  )
  const scoped = products.filter((product) => {
    const title = normalized(product.title)
    return [...orderTitles].some((orderTitle) =>
      orderTitle === title || orderTitle.includes(title) || title.includes(orderTitle),
    )
  })
  if (!scoped.length) return null
  return matchVariantChoice(scoped, { ...choice, contextKey: scoped.length === 1 ? scoped[0].id : null })
}

export function variantOrderData(match: MatchedVariant): AgentOrderData {
  return {
    items: [{
      product_name: match.productName,
      quantity: 1,
      price: match.price,
      variant_id: match.variantId || undefined,
      variant_title: match.variantTitle,
      sku: match.sku || undefined,
    }],
    product_name: match.productName,
    quantity: 1,
    price: match.price,
    total_amount: match.price,
    currency: match.currency,
    selected_variant: match.variantTitle,
  }
}

function mergeItem(existing: OrderItem, incoming: OrderItem): OrderItem {
  const sameProduct = normalized(existing.product_name) === normalized(incoming.product_name)
  if (!sameProduct) return incoming
  return {
    ...existing,
    ...incoming,
    // Exact catalogue selection wins over an LLM's generic/base product item.
    variant_id: existing.variant_id || incoming.variant_id,
    variant_title: existing.variant_title || incoming.variant_title,
    sku: existing.sku || incoming.sku,
    price: existing.variant_title ? existing.price : incoming.price,
  }
}

/** Merge AI order data without losing the exact variant selected from a carousel. */
export function mergePendingOrderData(
  existing: AgentOrderData | null | undefined,
  incoming: AgentOrderData | null | undefined,
): AgentOrderData {
  const prior = existing || {}
  const next = incoming || {}
  const priorItems = Array.isArray(prior.items) ? prior.items : []
  const nextItems = Array.isArray(next.items) ? next.items : []
  let items = nextItems
  if (!nextItems.length) items = priorItems
  else if (priorItems.length) {
    items = nextItems.map((item) => {
      const match = priorItems.find((priorItem) => normalized(priorItem.product_name) === normalized(item.product_name))
      return match ? mergeItem(match, item) : item
    })
    for (const priorItem of priorItems) {
      if (!items.some((item) => normalized(item.product_name) === normalized(priorItem.product_name))) items.push(priorItem)
    }
  }
  return { ...prior, ...next, ...(items.length ? { items } : {}) }
}

/**
 * Ask FlashManager to send the approved product-variant template.
 * The gateway is authoritative: `sent` means approved/live; `pending` means Meta
 * accepted the request but approval/delivery is still pending.
 */
export async function sendProductVariantCarousel(
  token: string,
  input: { to: string; product: Product; agentId: string },
): Promise<SendResult & { pending?: boolean }> {
  const result = await gwResult('/v1/whatsapp/send-variants', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: input.to,
      phone: input.to,
      productId: input.product.id,
      product_id: input.product.id,
      agentId: input.agentId,
      source: 'qunvert',
    }),
  }).catch(() => null)
  if (!result?.ok) {
    return {
      ok: false,
      error: result ? `variant_carousel_${result.status}` : 'variant_carousel_unavailable',
    }
  }
  const data = nestedRecord(result.data)
  const sent = data.sent === true || data.success === true
  const pending = data.pending === true
  if (!sent && !pending) {
    return { ok: false, error: clean(data.error) || 'variant_carousel_not_approved' }
  }
  return {
    ok: true,
    pending,
    messageId: clean(data.messageId || data.message_id) || undefined,
  }
}

/** Send FlashManager's existing-order carousel (the gateway's supported contract). */
export async function sendOrderVariantCarousel(
  token: string,
  orderId: string,
): Promise<SendResult & { pending?: boolean }> {
  const result = await gwResult('/v1/whatsapp/send-variants', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }).catch(() => null)
  if (!result?.ok) {
    const data = nestedRecord(result?.data)
    return {
      ok: false,
      error: clean(data.error) || (result ? `order_carousel_${result.status}` : 'order_carousel_unavailable'),
    }
  }
  const data = nestedRecord(result.data)
  const sent = data.sent === true || data.success === true
  const pending = data.pending === true
  if (!sent && !pending) return { ok: false, error: clean(data.error) || 'order_carousel_failed' }
  return {
    ok: true,
    pending,
    messageId: clean(data.messageId || data.message_id) || undefined,
  }
}

