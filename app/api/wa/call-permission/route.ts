export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

export async function GET(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()
  const url = new URL(req.url)
  const phone = url.searchParams.get('phone') || ''
  return gatewayProxy(ownerId, `/v1/whatsapp/call-permission?phone=${encodeURIComponent(phone)}`)
}

export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()
  const body = await req.json().catch(() => ({}))
  return gatewayProxy(ownerId, '/v1/whatsapp/call-permission', { method: 'POST', json: body })
}
