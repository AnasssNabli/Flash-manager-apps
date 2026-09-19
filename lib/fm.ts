import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { prisma } from './db'

/**
 * Everything this app needs to talk to FlashManager.
 *
 * Two token flavours reach us and both end up as "a bearer the gateway will
 * accept":
 *   • the permanent `fmagt_…` grant from the OAuth install — preferred, works
 *     whether or not the seller has the app open
 *   • the ~2-minute bridge session token the embedded page forwards on every
 *     request — the fallback that keeps the app usable for a seller who opened
 *     it from the sidebar before installing
 *
 * The app's own secret never leaves this server, so a leaked token of either
 * kind is useless on its own.
 */

const FM_HOST = (process.env.FM_HOST || '').replace(/\/$/, '')
const APP_ID = process.env.FM_APP_ID || 'whatsapp-business'
const APP_SECRET = process.env.FM_APP_SECRET || ''
const TICKET_SECRET = process.env.APP_TICKET_SECRET || APP_SECRET

function clientHeaders(): Record<string, string> {
  return { 'X-App-Id': APP_ID, 'X-App-Secret': APP_SECRET }
}

// ── Session-token introspection ────────────────────────────────────────────

interface Introspection {
  active: boolean
  sub?: string
  exp?: number
}

// Bridge tokens live ~2 minutes and the inbox polls every few seconds, so
// introspecting on every request would put one FM round-trip in front of each
// poll. Cache the verdict per token for its remaining lifetime (capped).
const introspectCache = new Map<string, { ownerId: string; exp: number; until: number }>()

function cacheKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function pruneCache() {
  if (introspectCache.size < 500) return
  const now = Date.now()
  for (const [k, v] of introspectCache) if (v.until <= now) introspectCache.delete(k)
}

export async function resolveOwner(token: string): Promise<{ ownerId: string; exp: number } | null> {
  if (!token || !FM_HOST || !APP_SECRET) return null

  const key = cacheKey(token)
  const hit = introspectCache.get(key)
  if (hit && hit.until > Date.now()) return { ownerId: hit.ownerId, exp: hit.exp }

  try {
    const res = await fetch(`${FM_HOST}/api/app-gateway/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clientHeaders() },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as Introspection
    if (!data.active || !data.sub) return null

    const exp = data.exp ?? Math.floor(Date.now() / 1000) + 60
    pruneCache()
    introspectCache.set(key, {
      ownerId: data.sub,
      exp,
      until: Math.min(exp * 1000, Date.now() + 60_000),
    })
    return { ownerId: data.sub, exp }
  } catch {
    return null
  }
}

/** Remember the freshest bridge token so gateway calls have a bearer to use. */
async function rememberSessionToken(ownerId: string, token: string, exp: number) {
  const expires = new Date(exp * 1000)
  await prisma.app_tenants
    .upsert({
      where: { fm_owner_id: ownerId },
      create: { fm_owner_id: ownerId, fm_session_token: token, fm_session_exp: expires },
      update: { fm_session_token: token, fm_session_exp: expires },
    })
    .catch(() => {})
}

/**
 * Guard for the app's own API routes. The embedded page sends its current
 * bridge token as `x-fm-token`; we verify it with FlashManager and return the
 * seller it belongs to.
 */
export async function requireOwner(req: Request): Promise<string | null> {
  const token = req.headers.get('x-fm-token') || ''
  const owner = await resolveOwner(token)
  if (!owner) return null
  await rememberSessionToken(owner.ownerId, token, owner.exp)
  return owner.ownerId
}

// ── Media tickets ──────────────────────────────────────────────────────────
//
// <img>/<video> can't send headers, so media URLs carry a ticket instead: an
// HMAC of the owner id that this app issued itself. It grants nothing beyond
// "stream media for this seller through our own proxy" and expires in 12h.

const TICKET_TTL_SEC = 12 * 60 * 60

export function issueMediaTicket(ownerId: string): string {
  const payload = `${ownerId}.${Math.floor(Date.now() / 1000) + TICKET_TTL_SEC}`
  const sig = createHmac('sha256', TICKET_SECRET).update(payload).digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

export function verifyMediaTicket(ticket: string | null): string | null {
  if (!ticket) return null
  const [body, sig] = ticket.split('.')
  if (!body || !sig) return null

  let payload: string
  try {
    payload = Buffer.from(body, 'base64url').toString()
  } catch {
    return null
  }

  const expected = createHmac('sha256', TICKET_SECRET).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [ownerId, expStr] = payload.split('.')
  if (!ownerId || Number(expStr) * 1000 < Date.now()) return null
  return ownerId
}

// ── Gateway calls ──────────────────────────────────────────────────────────

/** The best bearer we currently hold for this seller, or null. */
export async function fmTokenFor(ownerId: string): Promise<string | null> {
  const tenant = await prisma.app_tenants
    .findUnique({
      where: { fm_owner_id: ownerId },
      select: { fm_access_token: true, fm_session_token: true, fm_session_exp: true },
    })
    .catch(() => null)

  if (tenant?.fm_access_token) return tenant.fm_access_token
  // Leave a few seconds of headroom so we don't send a token that expires
  // mid-flight.
  if (tenant?.fm_session_token && tenant.fm_session_exp && tenant.fm_session_exp.getTime() > Date.now() + 5_000) {
    return tenant.fm_session_token
  }
  return null
}

export interface GatewayCallOptions {
  method?: string
  /** JSON body — mutually exclusive with `raw`. */
  json?: unknown
  /** Pre-built body (FormData for uploads). */
  raw?: BodyInit
  headers?: Record<string, string>
}

/** Raw gateway call — returns the Response so binary routes can stream it. */
export async function gatewayRequest(
  ownerId: string,
  path: string,
  opts: GatewayCallOptions = {},
): Promise<Response> {
  const token = await fmTokenFor(ownerId)
  if (!FM_HOST || !token) {
    return new Response(JSON.stringify({ success: false, error: 'not_connected' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return fetch(`${FM_HOST}/api/app-gateway${path.startsWith('/') ? path : `/${path}`}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...clientHeaders(),
      ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.raw,
    /**
     * Never cache. Next's Data Cache wraps `fetch` in App Router and keys GETs on
     * URL + headers, so `/v1/whatsapp/status` was being answered from a snapshot
     * taken before the seller connected: the platform reported their own number
     * while this app kept replaying `shared / setupChoice: pending`, which the UI
     * reads as "not connected" and answers with the connect card. Nothing here is
     * cacheable — every response is one tenant's live state.
     */
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  })
}

/** Gateway call that proxies the JSON response straight back to our client. */
export async function gatewayProxy(
  ownerId: string,
  path: string,
  opts: GatewayCallOptions = {},
): Promise<Response> {
  const res = await gatewayRequest(ownerId, path, opts)
  const text = await res.text()
  return new Response(text || '{}', {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * FlashManager's first-party WhatsApp routes (`/api/whatsapp/*`) sit outside
 * the app gateway and expect the seller's short-lived staff/bridge JWT — the
 * same token the iframe sends as `x-fm-token`. The gateway never grew a
 * `/v1/whatsapp/disconnect` route; this is the one that actually unlinks.
 */
export async function platformWhatsAppDisconnect(staffToken: string): Promise<Response> {
  if (!FM_HOST || !staffToken) {
    return new Response(JSON.stringify({ success: false, error: 'not_connected' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return fetch(`${FM_HOST}/api/whatsapp/disconnect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${staffToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  })
}

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
