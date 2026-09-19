export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/**
 * Completes Meta Embedded Signup. We forward exactly what the Meta popup gave
 * the browser — the OAuth code plus the ids from the message event — and
 * FlashManager does the token exchange, so the Meta app secret is never here.
 */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const body = await req.json().catch(() => ({}))
  return gatewayProxy(ownerId, '/v1/whatsapp/connect', { method: 'POST', json: body })
}
