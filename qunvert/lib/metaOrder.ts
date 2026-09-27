import { gw } from './fm'
import { listProducts, type Product } from './products'
import { ownerToken } from './tenants'

export type MetaOrderLine = {
  product_id?: string
  title: string
  sku?: string | null
  quantity: number
  price: number
}

function pick(fields: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key]?.trim()
    if (value) return value
  }
  return ''
}

function fromCatalog(products: Product[], ids: string[]): MetaOrderLine[] {
  const wanted = new Set(ids)
  return products
    .filter((product) => wanted.has(product.id) && Number(product.price) > 0)
    .map((product) => ({
      product_id: product.id,
      title: product.title,
      sku: product.variants?.find((variant) => variant.sku)?.sku || null,
      quantity: 1,
      price: Number(product.price),
    }))
}

/**
 * Create the FlashManager order for a confirmed Instagram or Facebook lead.
 * Panddo collects the lead; this is the same order push m-agents performs.
 */
export async function createMetaLeadOrder(input: {
  ownerId: string
  externalId: string
  fields: Record<string, string>
  lineItems?: MetaOrderLine[]
  productIds?: string[]
}): Promise<{ orderId: string | null; error: string | null }> {
  const name = pick(input.fields, 'FULL_NAME', 'NOM_COMPLET', 'NAME')
  const phone = pick(input.fields, 'PHONE_NUMBER', 'PHONE', 'TELEPHONE')
  if (!name || !phone) return { orderId: null, error: 'missing_required_fields' }

  const token = await ownerToken(input.ownerId)
  if (!token) return { orderId: null, error: 'no_fm_credentials' }

  let items = (input.lineItems || []).filter((item) => item.title && item.price > 0 && item.quantity > 0)
  if (!items.length && input.productIds?.length) {
    items = fromCatalog(await listProducts(token, '', 100), input.productIds)
  }
  if (!items.length) return { orderId: null, error: 'missing_products' }

  const city = pick(input.fields, 'CITY', 'VILLE')
  const address = pick(input.fields, 'ADDRESS', 'ADRESSE', 'STREET')
  const response = await gw<{
    success?: boolean
    orderId?: string
    order?: { id?: string; name?: string }
    error?: string
  }>('/v1/orders', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_name: name,
      customer_phone: phone,
      city: city || undefined,
      province: city || undefined,
      street: address || undefined,
      line_items: items.map((item) => ({
        title: item.title,
        sku: item.sku || undefined,
        quantity: item.quantity,
        price: item.price,
      })),
      source: 'm-agents',
      external_id: input.externalId,
      note: 'Instagram DM lead',
    }),
  })
  if (!response.success) return { orderId: null, error: response.error || 'order_create_failed' }
  return { orderId: response.order?.id || response.order?.name || response.orderId || null, error: null }
}
