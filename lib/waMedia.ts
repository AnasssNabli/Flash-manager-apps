export type WaMediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'text'
  | 'placeholder'
  | 'unsupported'
  | 'edit'
  | 'reaction'
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
    if (id) return id
  }
  return null
}

function kindFromMime(meta: Record<string, any>): WaMediaKind | null {
  const mime = String(meta.mime_type || meta.mimeType || meta.content_type || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime) return 'document'
  return null
}

export function messageKindOf(msg: MediaFields): WaMediaKind {
  const meta = metaOf(msg)
  const raw = String(msg.type || meta.message_type || '').trim().toLowerCase()
  if (raw === 'ptt' || raw === 'voice' || raw === 'voice_note') return 'audio'
  if (raw === 'media_placeholder' || raw === 'media') return mediaIdOf(msg) ? (kindFromMime(meta) || 'image') : 'placeholder'
  if (raw === 'errors' || raw === 'unsupported') return mediaIdOf(msg) ? (kindFromMime(meta) || 'image') : 'unsupported'
  if (['image', 'video', 'audio', 'document', 'sticker', 'location', 'text', 'reaction', 'edit'].includes(raw)) {
    return raw as WaMediaKind
  }
  const fromMime = kindFromMime(meta)
  if (fromMime) return fromMime
  if (mediaIdOf(msg)) return 'image'
  if (raw) return 'unknown'
  return msg.body ? 'text' : 'placeholder'
}

export function previewLabelForMessage(msg: MediaFields): string {
  const body = String(msg.body || '').trim()
  if (body && !/^🎠\s*Carousel\s*\(/i.test(body)) return body
  switch (messageKindOf(msg)) {
    case 'image':
    case 'sticker':
      return '📷 Photo'
    case 'video':
      return '🎥 Video'
    case 'audio':
      return '🎙️ Voice message'
    case 'document':
      return '📄 Document'
    case 'location':
      return '📍 Location'
    case 'placeholder':
      return '📷 Media'
    case 'unsupported':
      return 'Message not available'
    default:
      return body || '📷 Media'
  }
}
