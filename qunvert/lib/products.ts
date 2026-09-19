import { gw } from './fm'

export type Product = {
  id: string
  title: string
  price: number
  currency: string
  description: string | null
  image_url: string | null
  shop_domain?: string | null
  variants?: { id: string | null; title: string | null; sku: string | null; price: number }[]
}

export async function listProducts(token: string, search = '', limit = 40, shop = ''): Promise<Product[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (search.trim()) q.set('search', search.trim())
  if (shop.trim()) q.set('shop', shop.trim())
  try {
    const res = await gw<{ products?: Product[] }>(`/v1/products?${q}`, token)
    return Array.isArray(res?.products) ? res.products : []
  } catch {
    return []
  }
}

export function productContext(products: Product[], max = 8): string {
  return products
    .slice(0, max)
    .map((p) => {
      const price = p.price ? `${p.price} ${p.currency || ''}`.trim() : ''
      const desc = (p.description || '').replace(/\s+/g, ' ').slice(0, 160)
      return `- ${p.title}${price ? ` (${price})` : ''}${desc ? `: ${desc}` : ''}`
    })
    .join('\n')
}
