import { gw, gwResponse } from './fm'
import { sendMessage, uploadWhatsAppMedia, type SendResult } from './wa'

export type GatewayFile = {
  id: string
  name: string
  contentType: string
  kind: string
  size: number
  url?: string
  createdAt?: string
}

export function extractMediaTokens(text: string): { cleanText: string; names: string[] } {
  const names: string[] = []
  const cleanText = String(text || '')
    .replace(/\{media:([^}]+)\}/gi, (_match, name) => {
      const normalized = String(name || '').trim()
      if (normalized) names.push(normalized)
      return ''
    })
    .replace(/\{product_media:[^}]+\}/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleanText, names: [...new Set(names)] }
}

export async function listFiles(token: string): Promise<GatewayFile[]> {
  const result = await gw<{ files?: GatewayFile[] }>('/v1/files?limit=200', token)
  return Array.isArray(result.files) ? result.files : []
}

async function downloadFile(token: string, file: GatewayFile): Promise<Uint8Array> {
  if (!file.url) {
    const response = await gwResponse(`/v1/files/${encodeURIComponent(file.id)}`, token)
    return new Uint8Array(await response.arrayBuffer())
  }
  let url = file.url
  try {
    const parsed = new URL(file.url)
    if (parsed.pathname.startsWith('/api/files/view') && process.env.FM_HOST) {
      url = `${process.env.FM_HOST.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`
    }
  } catch {
    // Preserve the original signed URL.
  }
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`file_download_${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function mediaType(file: GatewayFile): 'image' | 'video' | 'audio' | 'document' {
  if (file.kind === 'image' || file.contentType?.startsWith('image/')) return 'image'
  if (file.kind === 'video' || file.contentType?.startsWith('video/')) return 'video'
  if (file.kind === 'audio' || file.contentType?.startsWith('audio/')) return 'audio'
  return 'document'
}

export async function sendOutputWithMedia(opts: {
  token: string
  to: string
  output: string
  remainingBudget: number
  beforeSend: (item: { kind: string; body: string }) => Promise<string>
  afterSend: (ledgerId: string, result: SendResult) => Promise<void>
}): Promise<{ sent: number; cleanText: string }> {
  const parsed = extractMediaTokens(opts.output)
  const files = parsed.names.length ? await listFiles(opts.token).catch(() => []) : []
  const byName = new Map<string, GatewayFile>()
  for (const file of [...files].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))) {
    const key = file.name.toLocaleLowerCase()
    if (!byName.has(key)) byName.set(key, file)
  }
  const resolved = parsed.names.map((name) => byName.get(name.toLocaleLowerCase())).filter((file): file is GatewayFile => !!file)
  const planned = resolved.length + (parsed.cleanText ? 1 : 0)
  if (planned === 0) throw new Error('no_deliverable_output')
  if (Number.isFinite(opts.remainingBudget) && planned > opts.remainingBudget) {
    throw new Error('max_ai_responses_reached')
  }

  let sent = 0
  for (let index = 0; index < resolved.length; index += 1) {
    const file = resolved[index]
    const kind = mediaType(file)
    const bytes = await downloadFile(opts.token, file)
    const mediaId = await uploadWhatsAppMedia(opts.token, bytes, {
      name: file.name,
      contentType: file.contentType || 'application/octet-stream',
      mediaType: kind,
    })
    const isLast = index === resolved.length - 1
    const caption = isLast && parsed.cleanText && parsed.cleanText.length <= 1024 ? parsed.cleanText : undefined
    const ledgerId = await opts.beforeSend({ kind, body: caption || `{media:${file.name}}` })
    const result = kind === 'audio'
      ? await sendMessage(opts.token, { to: opts.to, type: 'audio', mediaId })
      : kind === 'document'
        ? await sendMessage(opts.token, { to: opts.to, type: 'document', mediaId, caption })
        : await sendMessage(opts.token, { to: opts.to, type: kind, mediaId, caption })
    await opts.afterSend(ledgerId, result)
    if (!result.ok) throw new Error(result.error || 'send_failed')
    sent += 1
  }

  const captionUsed = resolved.length > 0 && !!parsed.cleanText && parsed.cleanText.length <= 1024
  if (parsed.cleanText && !captionUsed) {
    const ledgerId = await opts.beforeSend({ kind: 'text', body: parsed.cleanText })
    const result = await sendMessage(opts.token, { to: opts.to, type: 'text', text: parsed.cleanText })
    await opts.afterSend(ledgerId, result)
    if (!result.ok) throw new Error(result.error || 'send_failed')
    sent += 1
  }
  return { sent, cleanText: parsed.cleanText }
}
