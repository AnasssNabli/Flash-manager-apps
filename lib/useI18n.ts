'use client'

import { useCallback, useEffect, useState } from 'react'
import messages from './messages.json'
import { parseFmLocale, type FmLocale } from './fmLocale'

function getNested(obj: unknown, path: string): string | undefined {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj) as
    | string
    | undefined
}

function readUrlLocale(): FmLocale {
  try {
    const q = new URLSearchParams(window.location.search)
    return parseFmLocale(q.get('fm_locale') || q.get('fm_lang') || q.get('locale') || q.get('lang'))
  } catch {
    return 'en'
  }
}

export function useI18n() {
  const [locale, setLocale] = useState<FmLocale>('en')

  useEffect(() => {
    setLocale(readUrlLocale())
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; locale?: string } | null
      if (!d || d.type !== 'fm:locale' || typeof d.locale !== 'string') return
      setLocale(parseFmLocale(d.locale))
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const dict = (messages as Record<string, unknown>)[locale] || messages.en

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = getNested(dict, key) ?? getNested(messages.en, key) ?? key
      if (typeof s !== 'string') s = key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        }
      }
      return s
    },
    [dict],
  )

  return { t, locale }
}
