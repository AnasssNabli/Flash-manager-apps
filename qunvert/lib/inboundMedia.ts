export type InboundMediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'text'
  | 'placeholder'
  | 'unsupported'
  | 'unknown'

type MediaFields = {
  type?: string | null
  body?: string | null
  media_url?: string | null
  metadata?: Record<string, unknown> | null
}

function metaOf(msg: MediaFields): Record<string, any> {
  return msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {}
}

export function mediaIdOf(msg: MediaFields): string | null {
  const meta = metaOf(msg)
  const nested = [meta.image, meta.video, meta.audio, meta.document, meta.sticker]
  const candidates = [
    msg.media_url,
    meta.media_url,
    meta.media_id,
    meta.mediaId,
    typeof meta.id === 'string' && /^\d{5,}$/.test(meta.id) ? meta.id : null,
    ...nested.map((item) => (item && typeof item === 'object' ? item.id : null)),
  ]
  for (const value of candidates) {
    const id = String(value || '').trim()
    if (id && !id.startsWith('wamid.')) return id
  }
  return null
}

function mimeOf(msg: MediaFields): string {
  const meta = metaOf(msg)
  const nested = [meta.image, meta.video, meta.audio, meta.document, meta.sticker]
  const candidates = [
    meta.mime_type,
    meta.mimeType,
    meta.content_type,
    ...nested.map((item) => (item && typeof item === 'object' ? item.mime_type || item.mimeType : null)),
  ]
  return String(candidates.find(Boolean) || '').split(';')[0].trim().toLowerCase()
}

function kindFromMime(mime: string): InboundMediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime) return 'document'
  return null
}

export function messageKindOf(msg: MediaFields): InboundMediaKind {
  const meta = metaOf(msg)
  const raw = String(msg.type || meta.message_type || '').trim().toLowerCase()
  if (raw === 'ptt' || raw === 'voice' || raw === 'voice_note') return 'audio'
  if (raw === 'media_placeholder' || raw === 'media') return mediaIdOf(msg) ? (kindFromMime(mimeOf(msg)) || 'image') : 'placeholder'
  if (raw === 'errors' || raw === 'unsupported') return mediaIdOf(msg) ? (kindFromMime(mimeOf(msg)) || 'image') : 'unsupported'
  if (['image', 'video', 'audio', 'document', 'sticker', 'location', 'text', 'reaction', 'edit'].includes(raw)) {
    return raw as InboundMediaKind
  }
  const fromMime = kindFromMime(mimeOf(msg))
  if (fromMime) return fromMime
  if (mediaIdOf(msg)) return 'image'
  if (raw) return 'unknown'
  return msg.body ? 'text' : 'placeholder'
}

export function isVisualMessage(msg: MediaFields): boolean {
  const kind = messageKindOf(msg)
  if (kind === 'image' || kind === 'sticker') return true
  return kind === 'document' && mimeOf(msg).startsWith('image/')
}

export function isAudioMessage(msg: MediaFields): boolean {
  return messageKindOf(msg) === 'audio'
}

export function historyLabelForMessage(msg: MediaFields): string {
  const body = String(msg.body || '').trim()
  if (body) return body
  switch (messageKindOf(msg)) {
    case 'image':
    case 'sticker':
      return '[Customer sent a photo]'
    case 'video':
      return '[Customer sent a video]'
    case 'audio':
      return '[Customer sent a voice note]'
    case 'document':
      return '[Customer sent a document]'
    case 'location':
      return '[Customer sent a location]'
    default:
      return body
  }
}

export function sniffImageMime(bytes: Buffer, hinted = ''): string {
  const hint = String(hinted || '').split(';')[0].trim().toLowerCase()
  if (hint.startsWith('image/') && hint !== 'image/octet-stream') return hint
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  return hint.startsWith('image/') ? hint : 'image/jpeg'
}

export function audioFileName(contentType: string): string {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'voice.mp3'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'voice.m4a'
  if (mime.includes('wav')) return 'voice.wav'
  if (mime.includes('amr') || mime.includes('3gpp')) return 'voice.amr'
  return 'voice.ogg'
}

export function toDataUrl(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString('base64')}`
}
