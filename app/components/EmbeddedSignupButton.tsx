'use client'

import { useEffect, useState, useCallback } from 'react'
import { Icon } from '@iconify/react'
import { apiFetch } from '@/lib/waApi'
import type { WhatsAppHealth } from '@/lib/health'

// The Meta app behind the Embedded Signup configuration referenced by
// NEXT_PUBLIC_WA_EMBEDDED_CONFIG_ID — the same app FlashManager uses, since the
// resulting WABA is stored on the platform side.
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '3271295836383048'

type FinishPayload = {
  waba_id?: string
  phone_number_id?: string
}

export interface ConnectOutcome {
  phone?: { displayPhone?: string; verifiedName?: string }
  coexistenceMode?: boolean
  /** Meta's verdict, straight from the connect call — see lib/health.ts. */
  health?: WhatsAppHealth | null
}

interface EmbeddedSignupButtonProps {
  onConnected?: (payload: ConnectOutcome) => void
  onError?: (message: string) => void
  className?: string
  label?: string
}

/**
 * Meta Embedded Signup, run from inside the app.
 *
 * Loads the FB JS SDK, opens FB.login with the Coexistence (QR) config, and
 * forwards whatever the popup returns to our own /api/wa/connect — which
 * relays it to FlashManager, where the code is exchanged and the WABA is
 * stored. No Meta secret is ever present in this app.
 *
 * The popup is opened from an iframe, so the embed must allow popups
 * (`allow-popups allow-popups-to-escape-sandbox`) and this app's domain must be
 * allow-listed in the Meta app's "Allowed Domains for the JavaScript SDK".
 */
export default function EmbeddedSignupButton({
  onConnected,
  onError,
  className,
  label = 'Connect your WhatsApp Business',
}: EmbeddedSignupButtonProps) {
  const [sdkReady, setSdkReady] = useState(false)
  const [busy, setBusy] = useState(false)

  // ── Load Facebook JS SDK (fbAsyncInit pattern, no duplicates) ──────────────
  useEffect(() => {
    if (typeof window === 'undefined') return

    const initSDK = () => {
      ;(window as any).FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v22.0',
      })
      setSdkReady(true)
    }

    if ((window as any).FB) {
      initSDK()
      return
    }

    ;(window as any).fbAsyncInit = initSDK

    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.src = 'https://connect.facebook.net/en_US/sdk.js'
      script.async = true
      script.defer = true
      document.body.appendChild(script)
    }
  }, [])

  const handleClick = useCallback(() => {
    const FB = (window as any).FB
    if (!FB || !sdkReady) {
      onError?.('Facebook is still loading — please try again in a moment.')
      return
    }

    setBusy(true)
    const configId = process.env.NEXT_PUBLIC_WA_EMBEDDED_CONFIG_ID

    // Meta's popup posts back the WABA ID / phone number ID. We capture them
    // here so they can be forwarded together with the OAuth code from FB.login.
    let session: FinishPayload = {}
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com') && !event.origin.endsWith('meta.com')) return
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (msg.type === 'WA_EMBEDDED_SIGNUP') {
          if (msg.event === 'FINISH' || msg.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
            session = { waba_id: msg.data?.waba_id, phone_number_id: msg.data?.phone_number_id }
          } else if (msg.event === 'CANCEL' || msg.event === 'ERROR') {
            window.removeEventListener('message', onMessage)
            setBusy(false)
          }
        }
      } catch { /* non-JSON messages from unrelated postMessage senders */ }
    }
    window.addEventListener('message', onMessage)

    FB.login(
      (response: any) => {
        window.removeEventListener('message', onMessage)

        if (!response.authResponse) {
          setBusy(false)
          return
        }

        // FB Login for Business returns an OAuth code (response_type=code), not
        // an access token — the exchange happens on the FlashManager side.
        const code: string | undefined = response.authResponse.code

        ;(async () => {
          try {
            const payload: Record<string, string> = {}
            if (session.phone_number_id) payload.phone_number_id = session.phone_number_id
            if (session.waba_id)         payload.waba_id         = session.waba_id
            if (code)                    payload.code            = code

            const res = await apiFetch('/wa/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.success) throw new Error(data.error || 'Embedded signup failed')
            onConnected?.({ phone: data.phone, coexistenceMode: data.coexistenceMode, health: data.health ?? null })
          } catch (err: any) {
            onError?.(err?.message || 'Embedded signup failed')
          } finally {
            setBusy(false)
          }
        })()
      },
      configId
        ? {
            config_id: configId,
            // "Login for Business" REQUIRES response_type=code; the default
            // response_type=token is rejected outright for config_id flows.
            response_type: 'code',
            override_default_response_type: true,
            // COEXISTENCE (QR) onboarding — connect the number already running
            // on the merchant's WhatsApp Business app instead of registering a
            // new one. Requires the Meta app to be subscribed to the history /
            // smb_app_state_sync / smb_message_echoes webhook fields, otherwise
            // Meta silently falls back to the "add a new number" flow.
            extras: {
              setup: {},
              featureType: 'whatsapp_business_app_onboarding',
              sessionInfoVersion: '3',
              version: 'v4',
            },
          }
        : {
            scope: 'whatsapp_business_management,whatsapp_business_messaging',
            response_type: 'code',
            override_default_response_type: true,
            extras: { featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3', version: 'v4', setup: {} },
          }
    )
  }, [sdkReady, onConnected, onError])

  return (
    <button
      onClick={handleClick}
      disabled={busy || !sdkReady}
      className={
        className ??
        'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold text-white disabled:opacity-60 transition-all hover:brightness-110 hover:shadow-lg bg-[#25D366]'
      }
    >
      {busy ? (
        <>
          <Icon icon="svg-spinners:ring-resize" className="text-base" />
          Connecting…
        </>
      ) : !sdkReady ? (
        <>
          <Icon icon="svg-spinners:ring-resize" className="text-base" />
          Loading…
        </>
      ) : (
        <>
          <Icon icon="logos:whatsapp-icon" className="text-base" />
          {label}
        </>
      )}
    </button>
  )
}
