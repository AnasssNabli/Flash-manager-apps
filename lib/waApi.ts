'use client'

/**
 * Browser-side calls to this app's own API routes.
 *
 * Every request carries the current FlashManager bridge token, which the app's
 * server verifies before touching the gateway. Bridge tokens live ~2 minutes,
 * so a 401 triggers one refresh-and-retry rather than surfacing an error the
 * seller would have to recover from by reloading.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-business'

let sessionToken: string | null = null
let refresher: (() => Promise<string | null>) | null = null

export function setSessionToken(token: string | null) {
  sessionToken = token
}

export function setTokenRefresher(fn: (() => Promise<string | null>) | null) {
  refresher = fn
}

export async function apiFetch(path: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
  const headers = new Headers(init.headers)
  if (sessionToken) headers.set('x-fm-token', sessionToken)

  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })
  if (res.status === 401 && allowRetry && refresher) {
    const fresh = await refresher()
    if (fresh) {
      sessionToken = fresh
      return apiFetch(path, init, false)
    }
  }
  return res
}

export async function apiJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  return (await res.json().catch(() => ({}))) as T
}

/** Media is fetched by <img>/<video>, which can't set headers — hence the ticket. */
export function mediaUrl(mediaId: string, ticket: string): string {
  const id = String(mediaId || '').trim()
  if (!id) return ''
  if (/^https?:\/\//i.test(id) || id.startsWith('data:') || id.startsWith('blob:')) return id
  return `${BASE}/api/wa/media/${encodeURIComponent(id)}?mt=${encodeURIComponent(ticket)}`
}
