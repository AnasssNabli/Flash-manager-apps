export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { rememberGrant } from '@/lib/tenants'

const REDIRECT_URI = 'https://apps.flash-manager.com/whatsapp-ai-agents/api/oauth/callback'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const silent = url.searchParams.get('fm_silent') === '1'

  if (!code) {
    if (silent) return new Response('missing code', { status: 400 })
    return NextResponse.redirect(new URL('/whatsapp-ai-agents', req.url))
  }

  const host = (process.env.FM_HOST || '').replace(/\/$/, '')
  const res = await fetch(`${host}/api/app-gateway/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.FM_APP_ID,
      client_secret: process.env.FM_APP_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    owner_id?: string
  }

  if (data.access_token && data.owner_id) {
    await rememberGrant(data.owner_id, data.access_token)
  } else {
    console.error('[wa-ai] oauth exchange failed', res.status)
    if (silent) return new Response('oauth_failed', { status: 400 })
  }

  if (silent) return new Response('ok', { status: 200 })
  return NextResponse.redirect(new URL('/whatsapp-ai-agents', req.url))
}
