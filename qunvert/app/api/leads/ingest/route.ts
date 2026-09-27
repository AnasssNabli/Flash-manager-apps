export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'crypto'
import { readFileSync } from 'fs'
import { NextResponse } from 'next/server'
import { createMetaLeadOrder, type MetaOrderLine } from '@/lib/metaOrder'

function syncSecret(): string {
  if (process.env.FM_SYNC_SECRET) return process.env.FM_SYNC_SECRET
  try {
    const line = readFileSync('/www/apps/m-agents/.env', 'utf8')
      .split(/\r?\n/)
      .find((item) => item.startsWith('FM_SYNC_SECRET='))
    return String(line || '').slice('FM_SYNC_SECRET='.length).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  } catch {
    return ''
  }
}

function authorized(req: Request): boolean {
  const got = req.headers.get('x-fm-sync-secret') ?? ''
  const want = syncSecret()
  if (!want || got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

function parseLineItems(raw: unknown): MetaOrderLine[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const items: MetaOrderLine[] = []
  for (const row of raw.slice(0, 20)) {
    const item = (row ?? {}) as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const price = typeof item.price === 'number' ? item.price : Number(item.price)
    if (!title || !Number.isFinite(price) || price <= 0) continue
    items.push({
      product_id: typeof item.product_id === 'string' ? item.product_id : undefined,
      title,
      sku: typeof item.sku === 'string' ? item.sku : null,
      quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
      price,
    })
  }
  return items.length ? items : undefined
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId = typeof body?.fm_owner_id === 'string' ? body.fm_owner_id : ''
  if (!ownerId) return NextResponse.json({ ok: false, error: 'missing fm_owner_id' }, { status: 400 })
  if (body?.confirmed !== true) {
    return NextResponse.json({ ok: true, id: null, fm_order_id: null, fm_push_error: null })
  }

  const rawFields = (body?.fields ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawFields).slice(0, 20)) {
    const clean = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30)
    if (clean && (typeof value === 'string' || typeof value === 'number')) fields[clean] = String(value).slice(0, 500)
  }
  const productIds = Array.isArray(body?.product_ids)
    ? body.product_ids.filter((id): id is string => typeof id === 'string').slice(0, 20)
    : undefined
  const externalId = typeof body?.external_id === 'string' && body.external_id
    ? body.external_id.slice(0, 80)
    : `${typeof body?.automation_id === 'string' ? body.automation_id : 'lead'}:${pickPhone(fields)}`

  const pushed = await createMetaLeadOrder({
    ownerId,
    externalId: externalId || ownerId,
    fields,
    lineItems: parseLineItems(body?.line_items),
    productIds,
  })
  return NextResponse.json({
    ok: true,
    fm_order_id: pushed.orderId,
    fm_push_error: pushed.error,
  })
}

function pickPhone(fields: Record<string, string>) {
  return fields.PHONE_NUMBER || fields.PHONE || fields.TELEPHONE || ''
}
