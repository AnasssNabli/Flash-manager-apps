export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()
  return gatewayProxy(ownerId, `/v1/whatsapp/calls/${encodeURIComponent(params.id)}`)
}
