'use client'

import { useEffect } from 'react'

/**
 * Reads a host-provided theme from the iframe URL (?fm_theme=dark|light, plus
 * common aliases). This is the reliable FIRST-PAINT signal for a CROSS-ORIGIN
 * embed (apps.flash-manager.com framed by *.flash-manager.com) where reading
 * the parent document is blocked.
 */
function readParamDark(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search)
    const names = ['fm_theme', 'fmtheme', 'theme', 'mode', 'scheme', 'colorscheme', 'color-scheme', 'appearance']
    for (const n of names) {
      const v = q.get(n)
      if (v == null) continue
      const s = v.toLowerCase()
      if (['dark', 'night', '1', 'true'].includes(s)) return true
      if (['light', 'day', '0', 'false'].includes(s)) return false
    }
    return null
  } catch {
    return null
  }
}

const THEME_KEY = 'fm_theme'

/** Last explicit host theme, persisted so reloads without ?fm_theme= keep it. */
function readStoredDark(): boolean | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'dark') return true
    if (v === 'light') return false
    return null
  } catch {
    return null
  }
}

function storeDark(dark: boolean) {
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light') } catch { /* ignore */ }
}

/** Same-origin parent <html> read — only works when NOT framed cross-origin. */
function readParentDark(): boolean | null {
  try {
    const d = window.parent?.document
    if (!d || d === document) return null
    const cls = (d.documentElement.className || '').toLowerCase()
    if (/\bdark\b/.test(cls)) return true
    if (/\blight\b/.test(cls)) return false
    return null
  } catch {
    return null
  }
}

/**
 * Keeps the app's light/dark theme in sync with the FlashManager host, live.
 *
 * Priority (highest first):
 *   1. Explicit host signal — a postMessage `{ type:'fm:theme', theme }` (live
 *      toggles) or the `?fm_theme=` URL param (first paint). Once received it
 *      wins, so the periodic re-check never reverts to the OS setting. It is
 *      also persisted to localStorage for loads where the param is dropped.
 *   2. Same-origin parent <html> class (standalone / same-origin embeds).
 *   3. Persisted last host signal (cross-origin reload without ?fm_theme=).
 *   4. OS `prefers-color-scheme` (true standalone fallback).
 *
 * The host (FlashManager AppEmbed) sends `fm:theme` on the ready handshake, on
 * an explicit `fm:theme:request`, and on every toggle.
 */
export function ThemeSync() {
  useEffect(() => {
    const el = document.documentElement
    const apply = (dark: boolean) => {
      el.classList.toggle('dark', dark)
      el.style.colorScheme = dark ? 'dark' : 'light'
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    // Explicit host theme (message or URL param) — highest priority once known.
    let hostDark: boolean | null = readParamDark()
    if (hostDark !== null) storeDark(hostDark)

    const resolve = () => {
      if (hostDark !== null) return apply(hostDark)
      const parent = readParentDark()
      if (parent !== null) return apply(parent)
      const stored = readStoredDark()
      if (stored !== null) return apply(stored)
      apply(mq.matches)
    }

    resolve()

    const onMq = () => resolve()
    mq.addEventListener('change', onMq)

    const onMsg = (e: MessageEvent) => {
      const dd = e.data as { source?: string; type?: string; theme?: string; value?: string } | null
      if (!dd) return
      const t = dd.theme ?? (dd.type === 'fm:theme' ? dd.value : undefined)
      if (t === 'dark' || t === 'light') {
        hostDark = t === 'dark'
        storeDark(hostDark)
        apply(hostDark)
      }
    }
    window.addEventListener('message', onMsg)

    // Ask the host to send the current theme, in case it mounted before this
    // listener attached (targetOrigin '*' — this is a non-sensitive request).
    try { window.parent?.postMessage({ source: 'fm-app', type: 'fm:theme:request' }, '*') } catch { /* ignore */ }

    // Same-origin only: observe the host <html>/<body> for theme class changes.
    let observer: MutationObserver | null = null
    try {
      const d = window.parent?.document
      if (d && d !== document) {
        observer = new MutationObserver(resolve)
        const opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] }
        observer.observe(d.documentElement, opts)
        if (d.body) observer.observe(d.body, opts)
      }
    } catch {
      /* cross-origin — ignore */
    }

    // Safety re-check. Respects `hostDark`, so it never reverts an explicit
    // host signal back to the OS preference.
    const poll = window.setInterval(resolve, 1500)

    return () => {
      mq.removeEventListener('change', onMq)
      observer?.disconnect()
      window.clearInterval(poll)
      window.removeEventListener('message', onMsg)
    }
  }, [])

  return null
}
