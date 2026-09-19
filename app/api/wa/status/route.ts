export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Connection state — decides whether the app shows the connect card or the inbox. */
export async function GET(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) {
    // This 401 is what makes the app fall back to the connect card, so it must
    // say which half failed: a missing header (the page hadn't got a token yet)
    // reads very differently from one FlashManager rejected.
    const token = req.headers.get('x-fm-token') || ''
    console.warn(
      `[wa/status] unauthorized — token ${token ? `present (${token.length} chars)` : 'MISSING'}`,
    )
    return unauthorized()
  }
  const res = await gatewayProxy(ownerId, '/v1/whatsapp/status')
  if (!res.ok) console.warn(`[wa/status] gateway said ${res.status} for owner ${ownerId}`)
  return res
}
