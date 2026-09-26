/**
 * FlashManager passes the seller's app language to embedded apps as
 * `?fm_locale=en|fr|ar` (same convention as ad-finder / google-sheets).
 * We store it on the agent (`Agent.language`) so the AI knows which language
 * to open with before the customer has written anything.
 */
export type AppLocale = 'en' | 'fr' | 'ar'

export function normalizeAppLocale(value: unknown): AppLocale | null {
  const code = String(value || '').trim().toLowerCase().slice(0, 2)
  return code === 'en' || code === 'fr' || code === 'ar' ? code : null
}

/** Human description the models understand, incl. the Moroccan default for Arabic. */
export function languageName(value: unknown): string | null {
  const locale = normalizeAppLocale(value)
  if (locale === 'ar') return 'Moroccan Arabic (Darija) written in Arabic script'
  if (locale === 'fr') return 'French'
  if (locale === 'en') return 'English'
  return null
}

/**
 * Rules for messages that mix Arabic with Latin product names/codes so the
 * text does not render scrambled on WhatsApp or in the app.
 */
export const MIXED_SCRIPT_RULES = [
  'Mixed scripts: when writing in Arabic and you must include a Latin product name, code, or size (e.g. NG-52, MINI FOCUS, XL), keep the Latin token inside the sentence surrounded by Arabic words on both sides — never as the first or last word, and never directly before punctuation.',
  'Example: "شنو المقاسات المتوفرة فـ NG-52 ديال النساء؟" is correct; "شنو المقاسات المتوفرة فـ NG-52؟" is wrong.',
  'Never mix French and Arabic words in the same sentence except for product names, codes, or sizes.',
].join('\n')
