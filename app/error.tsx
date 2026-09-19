'use client'

import { useEffect } from 'react'

/**
 * App-wide client error boundary. Surfaces the real error message instead of
 * Next.js's generic "a client-side exception has occurred" so we can diagnose.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[m-agents] client error:', error)
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center bg-white dark:bg-[#141414] px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-lg font-semibold text-red-500">Application error</h1>
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-gray-100 dark:bg-white/5 p-3 text-left text-xs text-gray-700 dark:text-gray-300">
          {error?.message || String(error)}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#6f4dc5] px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
