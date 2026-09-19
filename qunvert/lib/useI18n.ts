'use client'

import { useCallback, useEffect, useState } from 'react'
import messages from './messages.json'

type Locale = 'en' | 'fr' | 'ar'

function getNested(obj: unknown, path: string): string | undefined {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj) as
    | string
    | undefined
}

export function useI18n() {
  const [locale, setLocale] = useState<Locale>('en')

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('fm_locale')
      if (q === 'fr' || q === 'ar' || q === 'en') setLocale(q)
    } catch {
      /* ignore */
    }
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
