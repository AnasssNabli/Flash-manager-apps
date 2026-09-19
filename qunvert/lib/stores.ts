import { gw } from './fm'

export type Store = {
  id: string
  domain: string
  name: string
  logoUrl: string | null
}

export async function listStores(token: string): Promise<Store[]> {
  try {
    const res = await gw<{ stores?: Store[] }>('/v1/stores', token)
    return Array.isArray(res?.stores) ? res.stores : []
  } catch {
    return []
  }
}
