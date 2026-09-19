'use client'

import { useEffect } from 'react'

/**
 * Root-level error boundary (replaces the layout when an error happens in the
 * layout itself or during root hydration). Surfaces the real message instead of
 * Next.js's generic "a client-side exception has occurred".
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[m-agents] global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ background: '#fff', color: '#111', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1 style={{ color: '#dc2626', fontSize: 18, fontWeight: 600 }}>Error (global)</h1>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#f3f4f6',
            padding: 12,
            borderRadius: 8,
            fontSize: 12,
            marginTop: 12,
          }}
        >
          {error?.message || String(error)}
          {error?.stack ? `\n\n${error.stack}` : ''}
          {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            background: '#6f4dc5',
            color: '#fff',
            border: 0,
            borderRadius: 8,
            padding: '8px 16px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
