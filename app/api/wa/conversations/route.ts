export const dynamic = 'force-dynamic'

import { requireOwner, gatewayProxy, unauthorized } from '@/lib/fm'
import { collapseMirroredThread } from '@/lib/threadDedupe'

/** Inbox reads — conversation list, or one thread when `?phone=` is present. */
export async function GET(req: Request) {
  const ownerId = await requireOwner(req)
  if (!ownerId) return unauthorized()

  const incoming = new URL(req.url).searchParams
  const params = new URLSearchParams()
  for (const key of ['phone', 'filter', 'search', 'connections', 'offset', 'limit']) {
    const value = incoming.get(key)
    if (value) params.set(key, value)
  }

  const qs = params.toString()
  const upstream = await gatewayProxy(ownerId, `/v1/whatsapp/conversations${qs ? `?${qs}` : ''}`)
  if (!incoming.get('phone')) return upstream

  const text = await upstream.text()
  try {
    const data = JSON.parse(text) as { messages?: unknown }
    if (Array.isArray(data.messages)) {
      data.messages = collapseMirroredThread(data.messages as Parameters<typeof collapseMirroredThread>[0])
    }
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(text || '{}', {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
