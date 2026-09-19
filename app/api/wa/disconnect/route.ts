export const dynamic = 'force-dynamic'

import {
  gatewayRequest,
  platformWhatsAppDisconnect,
  requireOwner,
  unauthorized,
} from '@/lib/fm'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function readJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function statusStillOwn(ownerId: string): Promise<boolean | null> {
  const res = await gatewayRequest(ownerId, '/v1/whatsapp/status')
  const data = readJson(await res.text().catch(() => ''))
  if (!data || typeof data.connected !== 'boolean') return null
  return data.connected === true && data.isShared !== true
}

/**
 * Unlink the seller's own WhatsApp number.
 *
 * FlashManager stores the WABA on the platform. The app gateway can connect
 * (`POST /v1/whatsapp/connect`) but has no disconnect twin, so we call the
 * platform route with the live bridge token, then confirm on `/status`.
 */
export async function POST(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const staffToken = req.headers.get('x-fm-token') || ''
  const native = await platformWhatsAppDisconnect(staffToken)
  const nativeText = await native.text().catch(() => '')
  const nativeJson = readJson(nativeText)

  if (native.ok && nativeJson?.success !== false) {
    return jsonResponse({ success: true })
  }

  // In case the gateway grows the route later — same shape as connect.
  const gateway = await gatewayRequest(ownerId, '/v1/whatsapp/disconnect', {
    method: 'POST',
    json: {},
  })
  const gatewayText = await gateway.text().catch(() => '')
  const gatewayJson = readJson(gatewayText)
  if (gateway.ok && gatewayJson && gatewayJson.success !== false) {
    return jsonResponse({ success: true })
  }

  const stillOwn = await statusStillOwn(ownerId)
  if (stillOwn === false) return jsonResponse({ success: true })

  const error =
    (typeof nativeJson?.error === 'string' && nativeJson.error) ||
    (typeof gatewayJson?.error === 'string' && gatewayJson.error) ||
    'Could not disconnect this WhatsApp number.'

  return jsonResponse({ success: false, error }, native.status === 401 ? 401 : 502)
}
