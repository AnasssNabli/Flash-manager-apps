import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { readFileSync } from 'fs'

export type MetaProvider = 'instagram' | 'facebook'

let sharedMetaEnv: Record<string, string> | null = null

function sharedMetaValue(name: string): string {
  if (process.env[name]) return process.env[name] || ''
  if (sharedMetaEnv === null) {
    sharedMetaEnv = {}
    try {
      const path = process.env.M_AGENTS_ENV_PATH || '/www/apps/m-agents/.env'
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!match) continue
        const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
        sharedMetaEnv[match[1]] = value
      }
    } catch {
      // The AI Agents app can still use its own environment variables.
    }
  }
  return sharedMetaEnv[name] || ''
}

const igAppId = () => sharedMetaValue('INSTAGRAM_APP_ID')
const igAppSecret = () => sharedMetaValue('INSTAGRAM_APP_SECRET')
const fbAppId = () => sharedMetaValue('META_APP_ID')
const fbAppSecret = () => sharedMetaValue('META_APP_SECRET')
const redirectUri = () =>
  sharedMetaValue('META_REDIRECT_URI') || 'https://platform.panddo.com/api/auth/facebook/callback'
const stateSecret = () =>
  process.env.META_STATE_SECRET || process.env.FM_APP_SECRET || process.env.FM_SYNC_SECRET || ''

export const metaConfigured = (provider: MetaProvider) =>
  provider === 'facebook'
    ? Boolean(fbAppId() && fbAppSecret() && stateSecret())
    : Boolean(igAppId() && igAppSecret() && stateSecret())

export const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',')

export const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'business_management',
].join(',')

const IG_GRAPH = 'https://graph.instagram.com'
const FB_GRAPH = 'https://graph.facebook.com/v23.0'
const STATE_PREFIX = 'qvagents_'
const BRIDGED_STATE_PREFIX = 'fmagents_qvagents_'

export type MetaPost = {
  id: string
  caption: string
  imageUrl: string | null
  timestamp: string
}

export function signMetaState(ownerId: string, provider: MetaProvider): string {
  const payload = Buffer.from(JSON.stringify({
    o: ownerId,
    p: provider,
    e: Date.now() + 10 * 60_000,
    n: randomBytes(8).toString('hex'),
  })).toString('base64url')
  const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url')
  return `${BRIDGED_STATE_PREFIX}${payload}.${sig}`
}

export function verifyMetaState(state: string): { ownerId: string; provider: MetaProvider } | null {
  const raw = String(state || '')
  if (!stateSecret()) return null
  const normalized = raw.startsWith(BRIDGED_STATE_PREFIX)
    ? `${STATE_PREFIX}${raw.slice(BRIDGED_STATE_PREFIX.length)}`
    : raw
  if (!normalized.startsWith(STATE_PREFIX)) return null
  const [payload, sig] = normalized.slice(STATE_PREFIX.length).split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', stateSecret()).update(payload).digest('base64url')
  const actualBytes = Buffer.from(sig)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      o?: string
      p?: string
      e?: number
    }
    if (!data.o || typeof data.e !== 'number' || Date.now() > data.e) return null
    if (data.p !== 'instagram' && data.p !== 'facebook') return null
    return { ownerId: data.o, provider: data.p }
  } catch {
    return null
  }
}

export function buildMetaAuthUrl(ownerId: string, provider: MetaProvider): string {
  const state = signMetaState(ownerId, provider)
  if (provider === 'facebook') {
    const query = new URLSearchParams({
      client_id: fbAppId(),
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: FB_SCOPES,
      auth_type: 'rerequest',
      state,
    })
    return `https://www.facebook.com/v23.0/dialog/oauth?${query}`
  }
  const query = new URLSearchParams({
    client_id: igAppId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: IG_SCOPES,
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${query}`
}

async function metaJson(response: Response, action: string): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  const graphError = data?.error as { message?: string } | undefined
  if (!response.ok || !data || graphError || data.error_message) {
    throw new Error(`${action}: ${String(data?.error_message || graphError?.message || `HTTP ${response.status}`)}`)
  }
  return data
}

export async function connectInstagram(code: string) {
  const exchange = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: igAppId(),
      client_secret: igAppSecret(),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code: code.replace(/#_$/, ''),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const short = await metaJson(exchange, 'Instagram connection')
  const longQuery = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: igAppSecret(),
    access_token: String(short.access_token),
  })
  const long = await metaJson(
    await fetch(`${IG_GRAPH}/access_token?${longQuery}`, { signal: AbortSignal.timeout(15_000) }),
    'Instagram token',
  )
  const token = String(long.access_token)
  const profileQuery = new URLSearchParams({
    fields: 'user_id,username,name',
    access_token: token,
  })
  const profile = await metaJson(
    await fetch(`${IG_GRAPH}/v23.0/me?${profileQuery}`, { signal: AbortSignal.timeout(15_000) }),
    'Instagram profile',
  )
  return {
    externalId: String(profile.user_id || profile.id),
    displayName: profile.name ? String(profile.name) : null,
    username: profile.username ? String(profile.username) : null,
    accessToken: token,
    scope: IG_SCOPES,
  }
}

export async function connectFacebook(code: string) {
  const exchangeQuery = new URLSearchParams({
    client_id: fbAppId(),
    client_secret: fbAppSecret(),
    redirect_uri: redirectUri(),
    code,
  })
  const short = await metaJson(
    await fetch(`${FB_GRAPH}/oauth/access_token?${exchangeQuery}`, { signal: AbortSignal.timeout(15_000) }),
    'Facebook connection',
  )
  const longQuery = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: fbAppId(),
    client_secret: fbAppSecret(),
    fb_exchange_token: String(short.access_token),
  })
  const long = await metaJson(
    await fetch(`${FB_GRAPH}/oauth/access_token?${longQuery}`, { signal: AbortSignal.timeout(15_000) }),
    'Facebook token',
  )
  const pagesQuery = new URLSearchParams({
    access_token: String(long.access_token),
    fields: 'id,name,access_token',
    limit: '100',
  })
  const response = await metaJson(
    await fetch(`${FB_GRAPH}/me/accounts?${pagesQuery}`, { signal: AbortSignal.timeout(15_000) }),
    'Facebook Pages',
  )
  const rows = Array.isArray(response.data) ? response.data as Record<string, unknown>[] : []
  return rows.filter((page) => page.id && page.access_token).map((page) => ({
    externalId: String(page.id),
    displayName: page.name ? String(page.name) : null,
    username: null,
    accessToken: String(page.access_token),
    scope: FB_SCOPES,
  }))
}

export async function fetchMetaPosts(input: {
  provider: MetaProvider
  externalId: string
  accessToken: string
}): Promise<MetaPost[]> {
  if (input.provider === 'instagram') {
    const query = new URLSearchParams({
      fields: 'id,caption,media_type,media_url,thumbnail_url,timestamp',
      limit: '40',
      access_token: input.accessToken,
    })
    const response = await metaJson(
      await fetch(`${IG_GRAPH}/v23.0/me/media?${query}`, { signal: AbortSignal.timeout(15_000) }),
      'Instagram posts',
    )
    const rows = Array.isArray(response.data) ? response.data as Record<string, unknown>[] : []
    return rows.map((post) => ({
      id: String(post.id),
      caption: String(post.caption || 'Instagram post').slice(0, 300),
      imageUrl: post.thumbnail_url || post.media_url ? String(post.thumbnail_url || post.media_url) : null,
      timestamp: String(post.timestamp || ''),
    }))
  }

  const query = new URLSearchParams({
    fields: 'id,message,full_picture,created_time',
    limit: '40',
    access_token: input.accessToken,
  })
  const response = await metaJson(
    await fetch(`${FB_GRAPH}/${encodeURIComponent(input.externalId)}/posts?${query}`, {
      signal: AbortSignal.timeout(15_000),
    }),
    'Facebook posts',
  )
  const rows = Array.isArray(response.data) ? response.data as Record<string, unknown>[] : []
  return rows.map((post) => ({
    id: String(post.id),
    caption: String(post.message || 'Facebook post').slice(0, 300),
    imageUrl: post.full_picture ? String(post.full_picture) : null,
    timestamp: String(post.created_time || ''),
  }))
}
