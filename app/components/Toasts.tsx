'use client'

import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'

export interface Toast {
  id: number
  type: 'error' | 'success'
  message: string
}

/** Minimal toast stack — the app has no global store to hang one off. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = Date.now() + Math.random()
    setToasts(list => [...list, { id, type, message }])
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 5000)
  }, [])

  return { toasts, addToast }
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[400] flex flex-col items-center gap-2 px-4">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 w-full max-w-[min(100%,380px)] px-4 py-2.5 rounded-xl shadow-lg text-[13px] text-white ${
            t.type === 'error' ? 'bg-[#dc2626]' : 'bg-[#16a34a]'
          }`}
        >
          <Icon
            icon={t.type === 'error' ? 'solar:danger-triangle-bold' : 'solar:check-circle-bold'}
            className="text-base flex-shrink-0 mt-0.5"
          />
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
