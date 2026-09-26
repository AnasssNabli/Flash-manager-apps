import { gw, gwResult } from './fm'
import { stableHash } from './hash'
import type { MatchedVariant } from './variantCarousel'

export function phoneKey(phone: string | null | undefined): string {
  if (!phone) return ''
  const n = String(phone).replace(/\D/g, '')
  return n.length >= 8 ? n.slice(-9) : ''
}

export async function listBuyers(
  token: string,
  opts: { productIds?: string[]; after?: string | Date | null; phones?: string[] } = {},
): Promise<string[]> {
  const q = new URLSearchParams()
  if (opts.productIds?.length) q.set('productIds', opts.productIds.join(','))
  if (opts.after) q.set('after', opts.after instanceof Date ? opts.after.toISOString() : String(opts.after))
  if (opts.phones?.length) q.set('phones', opts.phones.slice(0, 400).join(','))
  try {
    const res = await gw<{ phones?: string[] }>(`/v1/orders/buyers?${q}`, token)
    return Array.isArray(res?.phones) ? res.phones : []
  } catch {
    return []
  }
}

export type CustomerOrderItem = {
  title: string
  qty: number
  price: number | null
  image?: string | null
  variant?: string | null
  sku?: string | null
}

export type CustomerOrder = {
  id: string
  name: string
  source: string
  createdAt: string
  total: number
  currency: string
  confirmation: string
  fulfillment: string | null
  financial: string
  archived: boolean
  items: CustomerOrderItem[]
  variants?: { productTitle: string; cardCount: number } | null
}

/** Existing FlashManager orders for the WhatsApp customer. */
export async function listCustomerOrders(token: string, phone: string): Promise<CustomerOrder[]> {
  try {
    const result = await gw<{ orders?: CustomerOrder[] }>(
      `/v1/whatsapp/contact-orders?phone=${encodeURIComponent(phone)}`,
      token,
    )
    return Array.isArray(result.orders)
      ? result.orders
          .filter((order) => order && order.id && !order.archived)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10)
      : []
  } catch {
    return []
  }
}

export type OrderVariantUpdateResult = {
  ok: boolean
  flashManagerUpdated?: boolean
  shopifyUpdated?: boolean
  error?: string
}

/**
 * Change an existing order only after a structured carousel click.
 * FlashManager owns Shopify credentials and is responsible for syncing there.
 */
export async function updateExistingOrderVariant(
  token: string,
  input: { order: CustomerOrder; variant: MatchedVariant },
): Promise<OrderVariantUpdateResult> {
  const result = await gwResult(`/v1/orders/${encodeURIComponent(input.order.id)}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'replace_variant',
      product_id: input.variant.productId,
      product_title: input.variant.productName,
      variant_id: input.variant.variantId,
      variant_title: input.variant.variantTitle,
      sku: input.variant.sku,
      price: input.variant.price,
      sync_shopify: true,
      source: 'qunvert',
    }),
  }).catch(() => null)
  if (!result?.ok) {
    return {
      ok: false,
      error: result ? `order_update_${result.status}` : 'order_update_unavailable',
    }
  }
  const data = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : {}
  if (data.success === false) return { ok: false, error: String(data.error || 'order_update_failed') }
  return {
    ok: true,
    flashManagerUpdated: data.flashManagerUpdated !== false,
    shopifyUpdated: data.shopifyUpdated === true,
  }
}

export type OrderItem = {
  product_name: string
  quantity: number
  price: string
  variant_id?: string
  variant_title?: string
  sku?: string
}

export type AgentOrderData = {
  items?: OrderItem[]
  product_name?: string
  quantity?: number
  price?: string
  total_amount?: string
  currency?: string
  customer_name?: string
  customer_city?: string
  customer_province?: string
  customer_address?: string
  customer_phone?: string
  [key: string]: unknown
}

export function orderFingerprint(phone: string, data: AgentOrderData): string {
  const items = data.items || [{
    product_name: data.product_name || '',
    quantity: data.quantity || 1,
    price: data.price || '',
  }]
  return stableHash(JSON.stringify({
    phone: phoneKey(phone),
    items,
    variants: items.map((item) => item.variant_id || item.variant_title || ''),
    total: data.total_amount || '',
  }))
}

export async function createAgentOrder(
  token: string,
  opts: {
    externalId: string
    phone: string
    data: AgentOrderData
    agentName: string
    /** Extra `Label: value` lines (custom lead-form fields) stored in the order note. */
    noteLines?: string[]
    /** Where the customer data came from. */
    channel?: 'chat' | 'whatsapp_flow'
  },
): Promise<{ orderId: string | null; duplicate: boolean }> {
  const items = Array.isArray(opts.data.items) && opts.data.items.length
    ? opts.data.items
    : [{
        product_name: String(opts.data.product_name || 'WhatsApp order'),
        quantity: Number(opts.data.quantity || 1),
        price: String(opts.data.price || '0'),
      }]
  const response = await gw<{
    success?: boolean
    action?: string
    orderId?: string
    order?: { id?: string; name?: string }
    error?: string
  }>('/v1/orders', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: String(opts.data.customer_name || 'WhatsApp customer'),
      customer_phone: opts.phone,
      city: opts.data.customer_city || undefined,
      province: opts.data.customer_province || opts.data.customer_city || undefined,
      street: opts.data.customer_address || undefined,
      address: opts.data.customer_address || undefined,
      line_items: items.map((item) => ({
        title: item.variant_title ? `${item.product_name} — ${item.variant_title}` : item.product_name,
        quantity: Math.max(1, Number(item.quantity || 1)),
        price: String(item.price || '0').replace(/[^\d.,-]/g, ''),
        variant_id: item.variant_id || undefined,
        sku: item.sku || undefined,
      })),
      source: 'qunvert-ai-agent',
      external_id: opts.externalId,
      tags: `Qunvert,${opts.agentName}${opts.channel === 'whatsapp_flow' ? ',WhatsApp Form' : ''}`,
      note: [
        `${opts.channel === 'whatsapp_flow' ? 'WhatsApp form order' : 'AI-confirmed WhatsApp order'}. Total: ${opts.data.total_amount || ''} ${opts.data.currency || ''}`.trim(),
        ...items
          .filter((item) => item.variant_title || item.sku)
          .map((item) => `Variant: ${item.product_name} — ${item.variant_title || 'default'}${item.sku ? ` (SKU ${item.sku})` : ''}`),
        ...(opts.noteLines || []),
      ].join('\n'),
    }),
  })
  if (!response.success) throw new Error(response.error || 'order_create_failed')
  return {
    orderId: response.order?.id || response.order?.name || response.orderId || null,
    duplicate: response.action === 'duplicate',
  }
}
