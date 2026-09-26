'use client'

import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

export default function DisconnectModal({
  phone,
  disconnecting,
  onCancel,
  onConfirm,
}: {
  phone?: string | null
  disconnecting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (typeof document === 'undefined') return null

  const number =
    phone && phone !== 'Platform inbox' ? phone : null

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={() => { if (!disconnecting) onCancel() }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-disconnect-title"
        className="relative w-full sm:max-w-sm rounded-2xl bg-white dark:bg-[#1f2c33] shadow-2xl border border-black/5 dark:border-white/10 p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
            <Icon icon="solar:logout-2-bold-duotone" className="text-2xl text-red-500" />
          </div>
          <div>
            <h3 id="wa-disconnect-title" className="text-base font-semibold text-gray-900 dark:text-white">
              Log out of WhatsApp?
            </h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-[#8696a0] leading-relaxed">
              {number ? (
                <>
                  This disconnects{' '}
                  <span className="font-semibold text-gray-700 dark:text-[#e9edef]">{number}</span>
                  {' '}from FlashManager. Your chats stay here — you can connect the same number again later.
                </>
              ) : (
                <>
                  This logs the current WhatsApp number out of FlashManager. Your chats stay here — you can connect again later.
                </>
              )}
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              type="button"
              disabled={disconnecting}
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-white/10 text-gray-600 dark:text-[#8696a0] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={disconnecting}
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {disconnecting && <Icon icon="solar:refresh-bold" className="animate-spin text-sm" />}
              {disconnecting ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
