export function isDoNotAnswerTool(name: string | null | undefined): boolean {
  const normalized = normalizeToolName(name)
  return normalized === 'donotanswer'
}

export function normalizeToolName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu

export function collapseRepeatedPhrases(text: string): string {
  const raw = String(text || '').replace(/\u00a0/g, ' ').trim()
  if (!raw) return ''
  const units = splitReplyUnits(raw)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const unit of units) {
    const key = normalizeReplyUnit(unit)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(unit.replace(/\s+/g, ' ').trim())
  }
  return collapseCopyPaste(kept.join(' ').replace(/\s+/g, ' ').trim())
}

export function customerAskedToWait(text: string): boolean {
  const last = String(text || '').trim().split(/\n+/).filter(Boolean).pop() || ''
  if (!last) return false
  const latin = /\b(wait\s+until|wait\s+till|wait\s+for\s+me\s+to\s+finish|don'?t\s+(answer|reply|respond)\s+yet|answer\s+(when|after)\s+i\b|hold\s+on\s+(please|a\s+sec)|let\s+me\s+finish)\b/i
  const french = /\b(attends?\s+(que\s+je|un\s+peu)|ne\s+(me\s+)?r[eé]pond(s|e|ez)?\s+pas\s+(encore|maintenant)|laisse[sz]?\s+moi\s+finir)\b/i
  const arabic = /حت[اى]\s+تكون|حتى\s+نسال|خليني\s+نسال|عاد\s+جاوب|من\s+بعد\s+(ن?تجاوب|جاوب)|متجاوبش|ما\s?تجاوبش|استناني|اتسن[اى]/
  return latin.test(last) || french.test(last) || arabic.test(last)
}

export function isSessionWindowError(error: string | null | undefined): boolean {
  const text = String(error || '').toLowerCase()
  return (
    text.includes('24h') ||
    text.includes('24 hour') ||
    text.includes('outside the window') ||
    text.includes('customer window') ||
    text.includes('session window') ||
    text.includes('needs a template') ||
    text.includes('reengagement') ||
    text.includes('outside_customer_window')
  )
}

function normalizeReplyUnit(value: string): string {
  return value
    .toLowerCase()
    .replace(EMOJI, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitReplyUnits(text: string): string[] {
  const parts = text
    .split(/(?:(?<=[.!?؟])\s*|\n+|\s*\p{Extended_Pictographic}\s*)/u)
    .map((part) => part.trim())
    .filter((part) => part && normalizeReplyUnit(part))
  return parts.length ? parts : [text.trim()]
}

function collapseCopyPaste(text: string): string {
  const words = text.split(' ').filter(Boolean)
  if (words.length < 4) return text
  for (let size = 1; size <= Math.floor(words.length / 2); size += 1) {
    const chunk = words.slice(0, size)
    const key = chunk.map(normalizeReplyUnit).join(' ')
    if (!key) continue
    let repeats = 1
    let index = size
    while (index + size <= words.length) {
      const next = words.slice(index, index + size).map(normalizeReplyUnit).join(' ')
      if (next !== key) break
      repeats += 1
      index += size
    }
    if (repeats >= 2 && index >= words.length) return chunk.join(' ')
  }
  return text
}
