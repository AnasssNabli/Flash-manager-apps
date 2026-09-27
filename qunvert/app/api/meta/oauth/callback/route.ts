export const dynamic = 'force-dynamic'

import { upsertMetaAccount } from '@/lib/channels'
import {
  connectFacebook,
  connectInstagram,
  verifyMetaState,
} from '@/lib/meta'

function popupPage(ok: boolean, message: string): Response {
  const color = ok ? '#3bbdb5' : '#ef4444'
  const safeMessage = message.replace(/[<>&'"]/g, '')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AI Agents</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#111116;color:#fff;font-family:system-ui,sans-serif">
<div style="max-width:360px;padding:28px;text-align:center">
<div style="width:58px;height:58px;margin:0 auto 16px;border-radius:18px;background:${color}22;color:${color};font-size:28px;line-height:58px">${ok ? '✓' : '✕'}</div>
<div style="font-size:16px;font-weight:650">${safeMessage}</div>
<p style="margin-top:8px;color:#9ca3af;font-size:13px">${ok ? 'You can return to AI Agents.' : 'Close this window and try again.'}</p>
</div>
<script>
try { if (window.opener) window.opener.postMessage({ source: 'ai-agents:oauth', ok: ${ok} }, '*') } catch (e) {}
${ok ? 'setTimeout(function () { window.close() }, 1200)' : ''}
</script></body></html>`
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams
  if (query.get('error') || query.get('error_reason')) {
    return popupPage(false, 'Connection cancelled.')
  }

  const state = verifyMetaState(query.get('state') || '')
  if (!state) return popupPage(false, 'This connection link expired.')
  const code = query.get('code') || ''
  if (!code) return popupPage(false, 'Connection code is missing.')

  try {
    if (state.provider === 'facebook') {
      const pages = await connectFacebook(code)
      if (!pages.length) return popupPage(false, 'No Facebook Page was found.')
      for (const page of pages) {
        await upsertMetaAccount(state.ownerId, 'facebook', page)
      }
      return popupPage(true, pages.length === 1
        ? `${pages[0].displayName || 'Facebook Page'} connected`
        : `${pages.length} Facebook Pages connected`)
    }

    const account = await connectInstagram(code)
    await upsertMetaAccount(state.ownerId, 'instagram', account)
    return popupPage(true, `@${account.username || account.displayName || 'Instagram'} connected`)
  } catch (error) {
    console.error('[meta-oauth]', (error as Error).message)
    return popupPage(false, 'Connection failed. Please try again.')
  }
}
