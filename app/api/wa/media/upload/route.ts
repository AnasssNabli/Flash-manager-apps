export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'

/** Uploads an attachment to Meta (via the gateway) and returns its media id. */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const incoming = await req.formData()
  const file = incoming.get('file')
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Rebuild the form rather than streaming the request through: fetch needs to
  // set its own multipart boundary on the outbound call.
  const outgoing = new FormData()
  outgoing.append('file', file, file.name || 'upload')
  const mediaType = incoming.get('mediaType')
  if (typeof mediaType === 'string' && mediaType) outgoing.append('mediaType', mediaType)

  return gatewayProxy(ownerId, '/v1/whatsapp/media/upload', { method: 'POST', raw: outgoing })
}
