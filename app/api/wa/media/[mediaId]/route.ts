export const dynamic = 'force-dynamic'

import { verifyMediaTicket, gatewayRequest } from '@/lib/fm'

function internalOwner(req: Request): string | null {
  const claimed = req.headers.get('x-owner-id') || ''
  if (!claimed || req.headers.get('x-internal-app') !== 'whatsapp-ai-agents') return null
  try {
    const host = new URL(req.url).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') return null
  } catch {
    return null
  }
  return claimed
}

/**
 * Streams an attachment to the browser.
 *
 * <img>/<video> can't send the app's headers, so this route authenticates with
 * the media ticket issued by /api/session and re-proxies the gateway response,
 * Range header included so video can seek.
 */
export async function GET(req: Request, { params }: { params: { mediaId: string } }) {
  const ownerId = verifyMediaTicket(new URL(req.url).searchParams.get('mt')) || internalOwner(req)
  if (!ownerId) return new Response('Unauthorized', { status: 401 })

  const range = req.headers.get('Range')
  const upstream = await gatewayRequest(ownerId, `/v1/whatsapp/media/${encodeURIComponent(params.mediaId)}`, {
    headers: range ? { Range: range } : undefined,
  })

  const headers = new Headers()
  for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = upstream.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('Cache-Control', 'private, max-age=3600')

  return new Response(upstream.body, { status: upstream.status, headers })
}
