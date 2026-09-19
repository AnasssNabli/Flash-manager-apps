import { gw } from './fm'
import { stableHash } from './hash'

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

export type OrderItem = {
  product_name: string
  quantity: number
  price: string
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
  customer_address?: string
  customer_phone?: string
  [key: string]: unknown
}

export function orderFingerprint(phone: string, data: AgentOrderData): string {
  return stableHash(JSON.stringify({
    phone: phoneKey(phone),
    items: data.items || [{
      product_name: data.product_name || '',
      quantity: data.quantity || 1,
      price: data.price || '',
    }],
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
      province: opts.data.customer_city || undefined,
      street: opts.data.customer_address || undefined,
      line_items: items.map((item) => ({
        title: item.product_name,
        quantity: Math.max(1, Number(item.quantity || 1)),
        price: String(item.price || '0').replace(/[^\d.,-]/g, ''),
      })),
      source: 'qunvert-ai-agent',
      external_id: opts.externalId,
      tags: `Qunvert,${opts.agentName}`,
      note: `AI-confirmed WhatsApp order. Total: ${opts.data.total_amount || ''} ${opts.data.currency || ''}`.trim(),
    }),
  })
  if (!response.success) throw new Error(response.error || 'order_create_failed')
  return {
    orderId: response.order?.id || response.order?.name || response.orderId || null,
    duplicate: response.action === 'duplicate',
  }
}
