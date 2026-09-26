'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { createBridge } from '@flashmanager/app-bridge'
import { apiJson, setSessionToken, setTokenRefresher } from '@/lib/waApi'
import { useToasts, ToastStack } from './components/Toasts'
import ConnectCard from './components/ConnectCard'
import type { ConnectOutcome } from './components/EmbeddedSignupButton'
import ConnectionHealth from './components/ConnectionHealth'
import Inbox from './components/Inbox'
import { hasActionableHealth, type WhatsAppHealth } from '@/lib/health'

/** Survives a refresh so the post-connect checklist is not lost, and so a
 *  blip on /status cannot dump a just-linked seller back on the connect card. */
const WA_VIEW_KEY = 'fm_wa_view'

function readWaView(): 'health' | 'inbox' | null {
  if (typeof window === 'undefined') return null
  const v = sessionStorage.getItem(WA_VIEW_KEY)
  return v === 'health' || v === 'inbox' ? v : null
}

function writeWaView(view: 'health' | 'inbox') {
  try { sessionStorage.setItem(WA_VIEW_KEY, view) } catch { /* private mode */ }
}

function clearWaView() {
  try { sessionStorage.removeItem(WA_VIEW_KEY) } catch { /* private mode */ }
}

interface WaStatus {
  connected?: boolean
  isShared?: boolean
  tokenExpired?: boolean
  /** 'pending' = the seller has never set WhatsApp up on any number. */
  setupChoice?: 'pending' | 'shared' | 'own'
  phone?: { verifiedName: string; displayPhone: string } | null
  /** Meta's verdict on the number — absent on the shared number. */
  health?: WhatsAppHealth | null
}

export default function Home() {
  const bridgeRef = useRef<ReturnType<typeof createBridge> | null>(null)
  // null = still checking; true = inside the FM iframe; false = opened standalone.
  const [embedded, setEmbedded] = useState<boolean | null>(null)
  const [mediaTicket, setMediaTicket] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  /**
   * The post-connect summary. Signup used to end in a "WhatsApp connected" toast,
   * which is true and useless: Meta may still be activating the number, reviewing
   * the business or refusing to send over a payment error. The summary is shown
   * once after connecting and stays reachable from the inbox while anything is open.
   */
  const [showHealth, setShowHealth] = useState(false)
  /**
   * What the connect call itself told us. The seller spends minutes in Meta's
   * dialog, and /status afterwards can come back empty (an expired bridge token is
   * enough) — trusting only /status is how a finished signup shows the connect
   * screen again. This is the receipt: it alone proves the number is linked.
   */
  const [connectOutcome, setConnectOutcome] = useState<ConnectOutcome | null>(null)
  const { toasts, addToast } = useToasts()
  // Super Admin embed (`/admin/whatsapp?platform=1`) — skip connect / sunset.
  const [platformInbox] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('platform') === '1'
  })

  /**
   * True when the last status call came back as something other than an answer.
   * Kept apart from `connected` on purpose: "we couldn't ask" and "you have no
   * number" look identical in the payload and must never look identical on screen,
   * because one of them tells a seller with a working number that it's gone.
   */
  const [statusUnknown, setStatusUnknown] = useState(false)

  const loadStatus = useCallback(async () => {
    let s = await apiJson<WaStatus>('/wa/status')
    // An error body carries no `connected` field. Reading that as "nothing is
    // connected" is how a seller who just linked a number lands back on the connect
    // screen, so a failed call gets one more attempt — by then the bridge token has
    // been refreshed — before we believe it.
    if (typeof s?.connected !== 'boolean') {
      await new Promise(resolve => setTimeout(resolve, 1500))
      const retry = await apiJson<WaStatus>('/wa/status')
      if (typeof retry?.connected === 'boolean') s = retry
    }
    setStatusUnknown(typeof s?.connected !== 'boolean')
    setStatus(s ?? {})
    return s
  }, [])

  useEffect(() => {
    setEmbedded(window.self !== window.top)
  }, [])

  // The OAuth install callback 302s back here with its verdict.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const installed = params.get('installed')
    const installError = params.get('install_error')
    if (!installed && !installError) return

    if (installed) addToast('success', 'App installed — your inbox now keeps working in the background.')
    else addToast('error', 'Install did not complete. You can still use the inbox while it is open.')

    params.delete('installed')
    params.delete('install_error')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [addToast])

  useEffect(() => {
    if (embedded !== true) return

    const bridge = createBridge({
      allowedHostOrigins: ['https://platform.flash-manager.com', 'https://dev.flash-manager.com'],
    })
    bridgeRef.current = bridge
    let cancelled = false

    // A 401 anywhere pulls a brand-new token from the host and retries once,
    // so an expired bridge token never surfaces to the seller.
    setTokenRefresher(async () => {
      try {
        const s = await bridge.getSessionToken()
        return s.token
      } catch {
        return null
      }
    })

    const openSession = async () => {
      const s = await bridge.getSessionToken()
      setSessionToken(s.token)
      const session = await apiJson<{ mediaTicket?: string; error?: string }>('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: s.token }),
      })
      if (!session?.mediaTicket) throw new Error(session?.error || 'session failed')
      return session.mediaTicket
    }

    /**
     * Embedded Signup normally runs in a popup and hands the code straight to
     * our JS — the page never navigates, so the seller stays on the inbox.
     * Browsers that suppress popups (Facebook/Instagram in-app webviews) make
     * the SDK fall back to a full-page redirect back to this URL with `?code=`.
     * Finishing the exchange here is what makes that path land on the inbox too
     * instead of an app that still thinks nothing is connected.
     */
    const finishRedirectSignup = async (): Promise<ConnectOutcome | null> => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (!code) return null

      params.delete('code')
      params.delete('state')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))

      const res = await apiJson<{ success?: boolean; error?: string } & ConnectOutcome>('/wa/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      // Success goes to the summary screen, not a toast — same as the popup path.
      if (res?.success) return { phone: res.phone, coexistenceMode: res.coexistenceMode, health: res.health ?? null }
      addToast('error', res?.error || 'Could not finish connecting WhatsApp')
      return null
    }

    ;(async () => {
      try {
        const ticket = await openSession()
        if (cancelled) return
        setMediaTicket(ticket)
        const outcome = await finishRedirectSignup().catch(() => null)
        if (cancelled) return
        if (outcome) {
          setConnectOutcome(outcome)
          writeWaView('health')
          setShowHealth(true)
        }
        await loadStatus()
        if (!cancelled && !outcome && readWaView() === 'health') setShowHealth(true)
      } catch (e) {
        if (!cancelled) setAuthError((e as Error).message)
      }
    })()

    // Bridge tokens expire in ~2 minutes. Re-opening the session well before
    // that keeps the server's fallback bearer valid for the whole visit.
    const interval = setInterval(() => {
      openSession()
        .then(t => { if (!cancelled) setMediaTicket(t) })
        .catch(() => {})
    }, 90_000)

    return () => {
      cancelled = true
      clearInterval(interval)
      setTokenRefresher(null)
      setSessionToken(null)
      bridge.destroy()
    }
  }, [embedded, loadStatus, addToast])

  const handleConnected = useCallback(async (outcome: ConnectOutcome) => {
    setShowSettings(false)
    // The summary is the confirmation: it says what Meta is still doing instead of
    // implying everything is finished. Meta's own verdict rides along with the
    // connect response, so it shows even if the status refresh below fails.
    setConnectOutcome(outcome)
    if (outcome.health) {
      writeWaView('health')
      setShowHealth(true)
    } else {
      writeWaView('inbox')
      addToast('success', `${outcome.phone?.displayPhone || 'Number'} linked. Opening your inbox.`)
    }
    await loadStatus()
  }, [loadStatus, addToast])

  const handleDisconnected = useCallback(async () => {
    clearWaView()
    setConnectOutcome(null)
    setShowHealth(false)
    setShowSettings(false)
    addToast('success', 'WhatsApp number disconnected.')
    await loadStatus()
  }, [loadStatus, addToast])

  // Opened directly (not embedded) → block use and point back to FlashManager.
  if (embedded === false) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0b141a] flex flex-col items-center justify-center text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-[#25D366]/10 flex items-center justify-center mb-4">
          <Icon icon="solar:lock-keyhole-bold-duotone" className="w-8 h-8 text-[#25D366]" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Open from FlashManager</h1>
        <p className="text-sm text-gray-500 dark:text-[#8696a0] max-w-sm">
          This app runs inside FlashManager. Open it from the WhatsApp entry in your sidebar.
        </p>
        <a
          href="https://platform.flash-manager.com/apps"
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#1da851] transition-colors"
        >
          Go to FlashManager
          <Icon icon="solar:arrow-right-linear" />
        </a>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0b141a] flex flex-col items-center justify-center text-center px-6">
        <Icon icon="solar:danger-triangle-bold-duotone" className="text-4xl text-amber-500 mb-3" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Couldn’t start the app</h1>
        <p className="text-sm text-gray-500 dark:text-[#8696a0] max-w-sm">
          Your session with FlashManager couldn’t be verified. Refresh the page and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-5 px-4 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#1da851] transition-colors"
        >
          Reload
        </button>
      </div>
    )
  }

  if (embedded === null || !mediaTicket) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0b141a] flex items-center justify-center">
        <Icon icon="svg-spinners:ring-resize" className="text-3xl text-[#25D366]" />
      </div>
    )
  }

  if (platformInbox) {
    return (
      <>
        {showSettings ? (
          <ConnectCard
            connectedPhone={status?.phone?.displayPhone || 'Platform inbox'}
            onBack={() => setShowSettings(false)}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
            addToast={addToast}
          />
        ) : (
          <Inbox
            mediaTicket={mediaTicket}
            connectedPhone={status?.phone?.displayPhone || 'Platform inbox'}
            sharedNumber={false}
            platformInbox
            health={null}
            onOpenSettings={() => setShowSettings(true)}
            addToast={addToast}
          />
        )}
        <ToastStack toasts={toasts} />
      </>
    )
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0b141a] flex items-center justify-center">
        <Icon icon="svg-spinners:ring-resize" className="text-3xl text-[#25D366]" />
      </div>
    )
  }

  /**
   * The status call failed and nothing else proves a connection. Showing the
   * connect card here is what makes a seller think their number dropped off — the
   * platform can be perfectly connected and simply unreachable for a moment.
   */
  if (statusUnknown && !connectOutcome && !showSettings) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0b141a] flex flex-col items-center justify-center text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
          <Icon icon="solar:wifi-router-minimalistic-bold-duotone" className="w-8 h-8 text-amber-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Couldn’t check your WhatsApp
        </h1>
        <p className="text-sm text-gray-500 dark:text-[#8696a0] max-w-sm">
          FlashManager didn’t answer, so we don’t know the state of your number — nothing has been
          disconnected. Try again in a moment.
        </p>
        <button
          onClick={() => { void loadStatus() }}
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#1da851] transition-colors"
        >
          <Icon icon="solar:refresh-bold" />
          Check again
        </button>
      </div>
    )
  }

  // `connected: true, isShared: true` is what the platform reports for ANY
  // seller with no integration of their own, because the shared number is
  // technically reachable — including someone who signed up an hour ago. Only a
  // seller who actually set WhatsApp up before (wa_setup_choice left 'pending'
  // otherwise) has an inbox worth showing, so that's the real gate here.
  //
  // Those sellers keep the full inbox until the shared number sunsets; taking it
  // away early would strand them. What they don't get is silence about it — the
  // inbox carries the countdown until they connect their own number.
  const hasHistory = status.setupChoice !== 'pending'
  // A connect that returned success is proof in its own right, and it outranks a
  // status call that came back empty.
  const ownNumber = (!!status.connected && !status.isShared) || !!connectOutcome
  const onShared = !connectOutcome && !!status.connected && !!status.isShared && hasHistory
  // A refresh must not send a seller who just linked a number back to Connect.
  // /status can 401 or replay a cached "not connected" for a few seconds.
  const rememberedOwn = readWaView() !== null
  const connected = ownNumber || onShared || rememberedOwn
  const phoneInfo =
    status.phone ??
    (connectOutcome?.phone?.displayPhone
      ? {
          displayPhone: connectOutcome.phone.displayPhone,
          verifiedName: connectOutcome.phone.verifiedName || '',
        }
      : null)
  const displayPhone = phoneInfo?.displayPhone ?? null
  // Only meaningful on the seller's own number: on the shared one they own none of
  // it and can fix none of it, so the platform sends no verdict.
  const health = ownNumber ? status.health ?? connectOutcome?.health ?? null : null

  return (
    <>
      {!connected || showSettings ? (
        <ConnectCard
          connectedPhone={onShared ? null : displayPhone}
          sharedNumber={onShared}
          onBack={connected ? () => setShowSettings(false) : undefined}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
          addToast={addToast}
        />
      ) : showHealth && health ? (
        <ConnectionHealth
          health={health}
          phone={phoneInfo}
          onRecheck={async () => { await loadStatus() }}
          onOpenInbox={() => { writeWaView('inbox'); setShowHealth(false) }}
          onSwitchNumber={() => { setShowHealth(false); setShowSettings(true) }}
        />
      ) : (
        <Inbox
          mediaTicket={mediaTicket}
          connectedPhone={displayPhone}
          sharedNumber={onShared}
          health={health}
          onOpenHealth={() => setShowHealth(true)}
          onOpenSettings={() => setShowSettings(true)}
          addToast={addToast}
        />
      )}

      {status.tokenExpired && !onShared && connected && !showSettings && !displayPhone && !connectOutcome && (
        <div className="fixed inset-x-4 bottom-4 z-[150] mx-auto flex max-w-[min(100%,420px)] items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/50 shadow-lg">
          <Icon icon="solar:danger-triangle-bold" className="text-amber-500 text-lg flex-shrink-0" />
          <span className="text-[13px] text-amber-900 dark:text-amber-200">
            Your WhatsApp connection expired.
          </span>
          <button
            onClick={() => setShowSettings(true)}
            className="text-[13px] font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2"
          >
            Reconnect
          </button>
        </div>
      )}

      <ToastStack toasts={toasts} />
    </>
  )
}
