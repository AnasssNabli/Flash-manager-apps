export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * FlashManager OAuth install callback.
 *
 * Reached IN-EMBED: FlashManager loads this URL inside the app iframe with the
 * one-time `code`. We exchange it server-to-server for a PERMANENT token
 * (`fmagt_…`), store it per seller, then 302 the iframe to the app home — so
 * the seller never leaves FlashManager.
 */

const FM_HOST = (process.env.FM_HOST || '').replace(/\/$/, '')
const APP_ID = process.env.FM_APP_ID || 'whatsapp-business'
const APP_SECRET = process.env.FM_APP_SECRET || ''
const BASE_PATH = process.env.BASE_PATH || '/whatsapp-business'
// Must EXACTLY match the redirect_uri registered on the FlashManager app registry.
const REDIRECT_URI =
  process.env.FM_OAUTH_REDIRECT_URI ||
  'https://apps.flash-manager.com/whatsapp-business/api/oauth/callback'

/** Root-relative 302 so it resolves against the public embed origin, staying in-iframe. */
function home(params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString()
  return new Response(null, {
    status: 302,
    headers: { Location: `${BASE_PATH}/${q ? `?${q}` : ''}` },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code') || ''
  const theme = url.searchParams.get('fm_theme') || ''
  const base: Record<string, string> = theme ? { fm_theme: theme } : {}

  if (!code) return home({ ...base, install_error: 'missing_code' })
  if (!FM_HOST || !APP_SECRET) return home({ ...base, install_error: 'not_configured' })

  try {
    const res = await fetch(`${FM_HOST}/api/app-gateway/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    })
    const data: {
      success?: boolean
      access_token?: string
      owner_id?: string
      scope?: string
      error?: string
    } = await res.json().catch(() => ({}))

    if (!res.ok || !data.success || !data.access_token || !data.owner_id) {
      console.error('[wa-business oauth] token exchange failed', res.status, data?.error)
      return home({ ...base, install_error: data?.error || 'exchange_failed' })
    }

    const scopes = (data.scope || '').split(' ').filter(Boolean)
    await prisma.app_tenants.upsert({
      where: { fm_owner_id: data.owner_id },
      create: {
        fm_owner_id: data.owner_id,
        fm_access_token: data.access_token,
        fm_token_scopes: scopes,
      },
      update: { fm_access_token: data.access_token, fm_token_scopes: scopes },
    })

    console.log(`[wa-business oauth] token stored for owner ${data.owner_id}`)
    return home({ ...base, installed: '1' })
  } catch (e) {
    console.error('[wa-business oauth] callback error', e)
    return home({ ...base, install_error: 'network' })
  }
}
