'use client'

import { useEffect } from 'react'

const THEME_KEY = 'fm_theme'

function readTheme(data: { theme?: unknown; value?: unknown; dark?: unknown } | null): boolean | null {
  if (!data) return null
  const raw = data.theme ?? data.value
  if (raw === 'dark' || raw === true) return true
  if (raw === 'light' || raw === false) return false
  if (typeof data.dark === 'boolean') return data.dark
  return null
}

function apply(dark: boolean) {
  const el = document.documentElement
  el.classList.toggle('dark', dark)
  el.style.colorScheme = dark ? 'dark' : 'light'
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch { /* ignore */ }
}

export function ThemeSync() {
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { source?: string; type?: string; theme?: unknown; value?: unknown; dark?: unknown } | null
      if (!data || data.source !== 'fm-host') return
      if (data.type !== 'fm:theme' && data.theme !== 'dark' && data.theme !== 'light') return
      const dark = readTheme(data)
      if (dark === null) return
      apply(dark)
    }
    window.addEventListener('message', onMsg)
    try { window.parent?.postMessage({ source: 'fm-app', type: 'fm:theme:request' }, '*') } catch { /* standalone */ }
    return () => window.removeEventListener('message', onMsg)
  }, [])
  return null
}
