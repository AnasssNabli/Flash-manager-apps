export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Orders placed by the open thread's contact — the "Order details" panel. */
export async function GET(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const phone = new URL(req.url).searchParams.get('phone')
  if (!phone) {
    return new Response(JSON.stringify({ success: false, error: 'phone required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return gatewayProxy(ownerId, `/v1/whatsapp/contact-orders?phone=${encodeURIComponent(phone)}`)
}
