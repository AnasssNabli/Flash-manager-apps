export const FM_LOCALES = [
  'en',
  'es',
  'fr',
  'ar',
  'pt',
  'de',
  'it',
  'tr',
  'nl',
  'id',
  'hi',
  'zh',
  'ja',
  'ko',
  'ru',
  'pl',
  'vi',
] as const

export type FmLocale = (typeof FM_LOCALES)[number]

const TAGS: Record<FmLocale, string> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  ar: 'ar',
  pt: 'pt',
  de: 'de',
  it: 'it',
  tr: 'tr',
  nl: 'nl',
  id: 'id',
  hi: 'hi',
  zh: 'zh-CN',
  ja: 'ja',
  ko: 'ko',
  ru: 'ru',
  pl: 'pl',
  vi: 'vi',
}

export function parseFmLocale(raw?: string | null): FmLocale {
  if (!raw) return 'en'
  const v = raw.toLowerCase().replace(/_/g, '-')
  if ((FM_LOCALES as readonly string[]).includes(v)) return v as FmLocale
  const base = v.split('-')[0]
  return (FM_LOCALES as readonly string[]).includes(base) ? (base as FmLocale) : 'en'
}

export function localeTag(locale: string): string {
  return TAGS[locale as FmLocale] || locale
}
