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

export function currentSessionToken() {
  return sessionToken
}

const FM_HOST_ORIGINS = ['https://platform.flash-manager.com', 'https://dev.flash-manager.com'] as const

/** The FlashManager tab that embedded this iframe — platform or dev. */
export function fmHostOrigin(): string {
  if (typeof window === 'undefined') return FM_HOST_ORIGINS[0]
  const ancestor = window.location.ancestorOrigins?.[0]
  if (ancestor && (FM_HOST_ORIGINS as readonly string[]).includes(ancestor)) return ancestor
  try {
    if (document.referrer) {
      const origin = new URL(document.referrer).origin
      if ((FM_HOST_ORIGINS as readonly string[]).includes(origin)) return origin
    }
  } catch { /* ignore */ }
  return FM_HOST_ORIGINS[0]
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

/**
 * Native `/api/whatsapp/disconnect` wants the seller’s FlashManager staff
 * JWT, not the short-lived app-bridge token. Prefer a readable cookie, then
 * the parent tab’s localStorage when the embed is same-origin.
 */
export function staffAuthToken(): string | null {
  const fromCookie = readCookie('staff_token') || readCookie('affiliate_token')
  if (fromCookie) return fromCookie
  try {
    return (
      window.parent.localStorage.getItem('staff_token') ||
      window.parent.localStorage.getItem('affiliate_token')
    )
  } catch {
    return null
  }
}

export function hostDisconnectSucceeded(res: Response | null, json: { success?: boolean; error?: string } | null): boolean {
  if (!res?.ok) return false
  if (json?.success === false || json?.error) return false
  return true
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
