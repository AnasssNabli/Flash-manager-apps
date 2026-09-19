export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Sends the product-option carousel for an order ("Send variants"). */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const body = await req.json().catch(() => ({}))
  return gatewayProxy(ownerId, '/v1/whatsapp/send-variants', { method: 'POST', json: body })
}
