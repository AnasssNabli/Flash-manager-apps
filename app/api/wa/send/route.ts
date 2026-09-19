export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Sends a message from the seller's own number. */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const body = await req.json().catch(() => ({}))
  return gatewayProxy(ownerId, '/v1/whatsapp/send', { method: 'POST', json: body })
}
