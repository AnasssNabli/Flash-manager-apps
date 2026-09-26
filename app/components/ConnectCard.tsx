'use client'

import { useState } from 'react'
import { Icon } from '@iconify/react'
import EmbeddedSignupButton, { type ConnectOutcome } from './EmbeddedSignupButton'
import DisconnectModal from './DisconnectModal'
import { daysUntilSunset, sunsetDateLabel } from '@/lib/sunset'
import { apiJson } from '@/lib/waApi'
import type { Toast } from './Toasts'

interface ConnectCardProps {
  /** Already connected — the card is in "reconnect / switch number" mode. */
  connectedPhone?: string | null
  /** Sending from the shared FlashManager number, which sunsets. */
  sharedNumber?: boolean
  /** Back to the inbox; absent when there's no working setup to return to. */
  onBack?: () => void
  onConnected: (outcome: ConnectOutcome) => void
  /** Own number is linked — drop it from FlashManager. */
  onDisconnected?: () => void
  addToast?: (type: Toast['type'], message: string) => void
}

/**
 * The first thing a seller sees in this app: connect the WhatsApp Business
 * number they already use on their phone, via Meta's Coexistence QR flow.
 *
 * Lives inside a fixed-height host iframe that does not scroll. The copy
 * scrolls; the connect button stays pinned to the bottom of the frame.
 */
export default function ConnectCard({
  connectedPhone,
  sharedNumber,
  onBack,
  onConnected,
  onDisconnected,
  addToast,
}: ConnectCardProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)
  /** Inbox already works — Back is present even when /status omitted the display number. */
  const alreadyLinked = Boolean(onBack || connectedPhone)

  const disconnectNumber = async () => {
    if (!alreadyLinked || disconnecting) return
    setDisconnecting(true)
    try {
      const res = await apiJson<{ success?: boolean; error?: string }>('/wa/disconnect', {
        method: 'POST',
      })
      if (res?.success) {
        setShowDisconnectModal(false)
        onDisconnected?.()
        return
      }
      addToast?.('error', res?.error || 'Could not disconnect this number.')
    } catch (err) {
      addToast?.('error', err instanceof Error ? err.message : 'Could not disconnect this number.')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#f7f7f5] dark:bg-[#0b141a]">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-8 sm:py-10">
        <div className="max-w-xl mx-auto">
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 mb-6 text-[13px] font-medium text-gray-500 dark:text-[#8696a0] hover:text-gray-800 dark:hover:text-[#e9edef] transition-colors"
            >
              <Icon icon="solar:alt-arrow-left-linear" className="text-base" />
              Back to inbox
            </button>
          )}

          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#25D366]/10 mb-4">
              <Icon icon="logos:whatsapp-icon" className="text-3xl" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {connectedPhone ? 'WhatsApp sender settings' : 'Connect your WhatsApp Business'}
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-[#8696a0]">
              {connectedPhone
                ? 'You’re connected. Use this only to reconnect or link a different number.'
                : 'Chat with your customers from FlashManager, using your own number and brand.'}
            </p>
          </div>

          {sharedNumber ? (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <Icon icon="solar:info-circle-bold" className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
              <div className="text-[13px] text-amber-900 dark:text-amber-200">
                <p>
                  You’re sending from the shared FlashManager number, which stops on{' '}
                  <span className="font-semibold">{sunsetDateLabel()}</span>
                  <span className="font-semibold"> — {daysUntilSunset()} days left</span>.
                </p>
                <p className="mt-1 text-amber-800/80 dark:text-amber-200/70">
                  Your inbox keeps working until then, and your existing conversations stay exactly
                  where they are.
                </p>
              </div>
            </div>
          ) : connectedPhone ? (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
              <Icon icon="solar:check-circle-bold" className="text-emerald-500 text-xl flex-shrink-0" />
              <p className="text-[13px] text-emerald-900 dark:text-emerald-200">
                Connected and sending from <span className="font-semibold">{connectedPhone}</span>.
              </p>
            </div>
          ) : null}

          <div className="relative bg-white dark:bg-[#1f2c33] border border-[rgba(37,211,102,0.35)] dark:border-[rgba(37,211,102,0.4)] rounded-2xl p-6 sm:p-7 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-[#25D366]/10 flex items-center justify-center">
                <Icon icon="solar:qr-code-bold-duotone" className="text-2xl text-[#25D366]" />
              </div>
              {alreadyLinked ? (
                <button
                  type="button"
                  onClick={() => setShowDisconnectModal(true)}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-2.5 py-1.5 text-[12px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 transition-colors"
                >
                  <Icon icon="solar:logout-2-bold" className="text-sm" />
                  Disconnect
                </button>
              ) : null}
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              Use your own WhatsApp Business
            </h2>
            <p className="mt-1 text-[13px] text-gray-500 dark:text-[#8696a0]">
              Connect the number that’s already on your phone with a code — no SMS verification.
            </p>

            <ul className="mt-5 space-y-2.5 text-[13px] text-gray-700 dark:text-[#d1d7db]">
              {[
                'Keep using your WhatsApp Business mobile app',
                'Send and receive from FlashManager and your phone',
                'Your own brand name, logo, and verified profile',
                'Recent chats are imported once you scan the code',
              ].map(line => (
                <li key={line} className="flex items-start gap-2">
                  <Icon icon="solar:check-circle-bold" className="text-emerald-500 text-base flex-shrink-0 mt-0.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-xl bg-[#f0f5ed] dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-2">
                What you need
              </p>
              <ul className="space-y-1.5 text-[12px] text-emerald-900 dark:text-emerald-200">
                <li className="flex items-start gap-1.5">
                  <Icon icon="solar:user-id-bold-duotone" className="text-sm flex-shrink-0 mt-0.5" />
                  <span>A Meta Business Portfolio — <em className="not-italic text-emerald-700 dark:text-emerald-300">we’ll guide you to create one if you don’t have one yet</em></span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Icon icon="solar:phone-bold-duotone" className="text-sm flex-shrink-0 mt-0.5" />
                  <span>The WhatsApp Business app installed on the number you want to use</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Icon icon="solar:clock-circle-bold-duotone" className="text-sm flex-shrink-0 mt-0.5" />
                  <span>About 2 minutes of your time</span>
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-emerald-700/80 dark:text-emerald-300/70 leading-relaxed">
                No business verification or paperwork to start. Meta then reviews your business, usually
                within 24 hours — messages keep working while it runs, up to 250 new conversations a day
                until you verify. We’ll show you exactly where the review stands right after you connect.
              </p>
            </div>

            {/*
              The trap this flow has: Meta's window offers to create a brand-new number,
              and a seller who takes it lands on a +1 555 test number that reaches nobody.
              Naming it here is cheaper than explaining it afterwards.
            */}
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 px-3.5 py-2.5">
              <Icon icon="solar:qr-code-bold-duotone" className="text-amber-500 text-base flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-900 dark:text-amber-200 leading-relaxed">
                In Meta’s window, choose the number that’s <span className="font-semibold">already in your
                WhatsApp Business app</span> and scan the code with it. If you let Meta create a new number
                instead, you get a test number your customers can’t message.
              </p>
            </div>
          </div>

          <p className="mt-8 mb-2 text-center text-[12px] text-gray-400 dark:text-[#67737a]">
            Your conversations stay in FlashManager — this app is just where you connect and chat.
          </p>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-black/5 dark:border-white/10 bg-[#f7f7f5]/95 dark:bg-[#0b141a]/95 backdrop-blur px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto">
          <EmbeddedSignupButton
            label={alreadyLinked ? 'Reconnect or switch number' : 'Connect your WhatsApp Business'}
            onConnected={onConnected}
            onError={setErrorMsg}
          />
          {errorMsg && (
            <p className="mt-2 text-[11px] text-red-500 text-center leading-relaxed">{errorMsg}</p>
          )}
        </div>
      </div>

      {showDisconnectModal && (
        <DisconnectModal
          phone={connectedPhone}
          disconnecting={disconnecting}
          onCancel={() => { if (!disconnecting) setShowDisconnectModal(false) }}
          onConfirm={() => { void disconnectNumber() }}
        />
      )}
    </div>
  )
}
