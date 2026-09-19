export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Super Admin platform inbox — owner attached to this WhatsApp number. */
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

  return gatewayProxy(ownerId, `/v1/whatsapp/contact-info?phone=${encodeURIComponent(phone)}`)
}
