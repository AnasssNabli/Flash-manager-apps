import { introspectToken, gatewayFetch } from '@flashmanager/app-bridge/server'

const host = process.env.FM_HOST as string
const appId = process.env.FM_APP_ID
const appSecret = process.env.FM_APP_SECRET

export type Owner = { ownerId: string; token: string }

export function gatewayOpts() {
  return { host, appId, appSecret }
}

export function bearerToken(req: Request, body?: { token?: string }): string {
  const header = req.headers.get('authorization') || ''
  const fromHeader = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  return fromHeader || (typeof body?.token === 'string' ? body.token : '')
}

export async function resolveOwner(token: string): Promise<Owner | null> {
  if (!token || !host) return null
  const res = await introspectToken(token, { host, appId, appSecret })
  if (!res.active || !res.sub) return null
  return { ownerId: res.sub, token }
}

export async function requireOwner(req: Request, body?: { token?: string }): Promise<Owner | null> {
  return resolveOwner(bearerToken(req, body))
}

export async function gw<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  return gatewayFetch<T>(path, token, {
    host,
    appId,
    appSecret,
    init: { cache: 'no-store', ...init },
  })
}

async function gatewayRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  const url = `${host.replace(/\/$/, '')}/api/app-gateway${path.startsWith('/') ? path : `/${path}`}`
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(appId ? { 'X-App-Id': appId } : {}),
      ...(appSecret ? { 'X-App-Secret': appSecret } : {}),
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    signal: init?.signal || AbortSignal.timeout(20_000),
  })
}

export async function gwResult(path: string, token: string, init?: RequestInit): Promise<{
  ok: boolean
  status: number
  text: string
  data: unknown
}> {
  const response = await gatewayRequest(path, token, init)
  const text = await response.text().catch(() => '')
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  return { ok: response.ok, status: response.status, text, data }
}

export async function gwResponse(path: string, token: string, init?: RequestInit): Promise<Response> {
  const response = await gatewayRequest(path, token, init)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`FM gateway ${response.status}: ${body || response.statusText}`)
  }
  return response
}

export function gatewayErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || '')
  if (/files:read|files:write/i.test(raw)) {
    return 'FlashManager Files isn’t enabled for AI Agents yet. Ask an admin to enable file access, then reopen the app.'
  }
  const jsonMatch = raw.match(/\{[\s\S]*\}$/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { error?: string }
      if (parsed.error) return parsed.error
    } catch {
      // Keep the stripped gateway text below.
    }
  }
  return raw.replace(/^FM gateway \d+:\s*/, '').trim() || fallback
}

export async function creditBalance(token: string): Promise<number | null> {
  if (!token || !host) return null
  try {
    const me = await gw<{ balance?: number }>('/v1/credits', token)
    return typeof me?.balance === 'number' ? me.balance : null
  } catch {
    return null
  }
}
