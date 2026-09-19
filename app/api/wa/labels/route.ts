export const dynamic = 'force-dynamic'

import { requireOwner, gatewayRequest, unauthorized } from '@/lib/fm'

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function gatewayJson(ownerId: string, path: string, init?: { method?: string; json?: unknown }) {
  const response = await gatewayRequest(ownerId, path, {
    method: init?.method,
    json: init?.json,
  })
  const text = await response.text().catch(() => '')
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { ok: false, status: response.status, data: null as unknown }
  }
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(trimmed) as unknown }
  } catch {
    return { ok: false, status: response.status, data: null as unknown }
  }
}

function collectLabelPaths(statusData: unknown): string[] {
  const record = statusData && typeof statusData === 'object' ? statusData as Record<string, unknown> : {}
  const wabaId = String(record.wabaId || record.waba_id || '').trim()
  const phoneNumberId = String(record.phoneNumberId || record.phone_number_id || '').trim()
  const paths = [
    '/v1/whatsapp/labels',
    '/v1/whatsapp/business-labels',
    '/v1/whatsapp/tags',
    '/v1/whatsapp/graph/labels',
    '/v1/whatsapp/conversation-labels',
    '/v1/whatsapp/assigned-labels',
  ]
  if (wabaId) {
    paths.push(
      `/v1/whatsapp/graph/${encodeURIComponent(wabaId)}/labels`,
      `/v1/whatsapp/graph?path=${encodeURIComponent(`/${wabaId}/labels`)}`,
      `/v1/whatsapp/${encodeURIComponent(wabaId)}/labels`,
    )
  }
  if (phoneNumberId) {
    paths.push(`/v1/whatsapp/phone/${encodeURIComponent(phoneNumberId)}/labels`)
  }
  return paths
}

function looksLikeLabelPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  const lists = [record.labels, record.data, record.items, record.tags]
  return lists.some((item) => Array.isArray(item) && item.length > 0)
}

export async function GET(req: Request) {
  const ownerId = (await requireOwner(req)) || internalOwner(req)
  if (!ownerId) return unauthorized()
  const status = await gatewayJson(ownerId, '/v1/whatsapp/status')
  for (const path of collectLabelPaths(status.data)) {
    const result = await gatewayJson(ownerId, path)
    if (result.ok && looksLikeLabelPayload(result.data)) {
      return jsonResponse(result.data)
    }
  }
  return jsonResponse({ success: true, labels: [] })
}

export async function POST(req: Request) {
  const ownerId = (await requireOwner(req)) || internalOwner(req)
  if (!ownerId) return unauthorized()
  const body = await req.json().catch(() => ({}))
  const paths = ['/v1/whatsapp/labels', '/v1/whatsapp/conversations/label', '/v1/whatsapp/assigned-labels']
  let last: { ok: boolean; status: number; data: unknown } | null = null
  for (const path of paths) {
    last = await gatewayJson(ownerId, path, { method: 'POST', json: body })
    if (last.ok) return jsonResponse(last.data)
  }
  return jsonResponse({ error: 'label_apply_failed' }, last?.status || 502)
}
