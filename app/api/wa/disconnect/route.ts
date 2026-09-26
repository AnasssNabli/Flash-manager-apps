export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/**
 * Unlink the seller’s WhatsApp number via the owner-scoped gateway.
 * The browser only has the short-lived app-bridge token — not a Super Admin
 * staff JWT — so this must go through `/v1/whatsapp/disconnect`.
 */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  return gatewayProxy(ownerId, '/v1/whatsapp/disconnect', { method: 'POST', json: {} })
}
