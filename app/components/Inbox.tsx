'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Icon } from '@iconify/react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { apiFetch, mediaUrl } from '@/lib/waApi'
import { daysUntilSunset, sunsetDateLabel } from '@/lib/sunset'
import { hasActionableHealth, openItemCount, type WhatsAppHealth } from '@/lib/health'
import { useWhatsAppCall } from '@/lib/useWhatsAppCall'
import { useI18n } from '@/lib/useI18n'
import { localeTag } from '@/lib/fmLocale'

/**
 * The seller's WhatsApp inbox.
 *
 * Same conversations, threads and media as the native FlashManager page — this
 * reads them through the App Gateway instead of the platform's own routes, so
 * there is exactly one inbox no matter which surface it's opened from.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  phone: string
  contactName: string | null
  lastMessage: string | null
  lastTimestamp: string
  unread: number
  direction: string
  needsReply?: boolean
  lastInboundAt?: string | null
  lastFailed?: boolean
  lastFailureCode?: number | null
  productImage?: string | null
  profileImage?: string | null
  connections?: { shopify: boolean; whatsapp: boolean; meta: boolean }
}

type ConnFilter = 'shopify' | 'whatsapp' | 'meta'

const CONN_ICONS: Array<{ key: ConnFilter; icon: string; label: string; color: string }> = [
  { key: 'shopify', icon: 'simple-icons:shopify', label: 'Shopify', color: '#95bf47' },
  { key: 'whatsapp', icon: 'simple-icons:whatsapp', label: 'WhatsApp', color: '#25d366' },
  { key: 'meta', icon: 'simple-icons:meta', label: 'Meta', color: '#0082fb' },
]

function ConnectionIcons({
  connections,
  size = 'text-[10px]',
}: {
  connections?: Conversation['connections']
  size?: string
}) {
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0" title="Shopify / WhatsApp / Meta">
      {CONN_ICONS.map(svc => (
        <Icon
          key={svc.key}
          icon={svc.icon}
          className={size}
          style={{ color: connections?.[svc.key] ? svc.color : '#d1d5db' }}
        />
      ))}
    </span>
  )
}

type ConvoFilter = 'all' | 'needs_reply' | 'unread' | 'sent'

interface ConversationPage {
  conversations: Conversation[]
  pagination?: {
    offset: number
    limit: number
    total: number
    hasMore: boolean
    nextOffset: number | null
  }
  counts?: { all: number; needsReply: number; unread: number; sent: number }
  filter?: ConvoFilter
}

interface WaTemplateButton {
  type: 'URL' | 'QUICK_REPLY' | 'PHONE_NUMBER' | 'COPY_CODE'
  text: string
  url?: string | null
  phone?: string | null
}

interface WaCarouselCard {
  image: string | null
  label: string
  buttonText?: string
  captionPrefix?: string
}

interface WaTemplatePreview {
  language: string
  rtl: boolean
  headerImageUrl: string | null
  headerText?: string | null
  body: string
  footerText: string | null
  buttons?: WaTemplateButton[]
  buttonText: string | null
  buttonUrl: string | null
  carousel?: WaCarouselCard[]
}

interface WaMessage {
  id: string
  wa_message_id: string
  direction: 'inbound' | 'outbound'
  from_phone: string
  to_phone: string | null
  body: string | null
  type: string
  status: string | null
  timestamp: string
  read: boolean
  metadata: any
  media_url: string | null
  template_preview?: WaTemplatePreview
}

interface ContactOrderItem {
  title: string
  qty: number
  price: number | null
  image?: string | null
  variant?: string | null
  sku?: string | null
}

interface ContactStatusEvent {
  id: string
  type: string
  fromStatus: string | null
  fromLabel: string | null
  toStatus: string
  toLabel: string
  note: string | null
  changedBy: string | null
  createdAt: string
}

interface ContactParcel {
  id: string
  companyName: string | null
  trackingNumber: string | null
  status: string
  createdAt: string
}

interface ContactOrder {
  id: string
  name: string
  source: string
  createdAt: string
  total: number
  currency: string
  itemsCount: number
  confirmation: string
  fulfillment: string | null
  financial: string
  city: string | null
  province: string | null
  note: string | null
  archived: boolean
  items: ContactOrderItem[]
  variants?: { productTitle: string; cardCount: number } | null
  statusHistory?: ContactStatusEvent[]
  parcels?: ContactParcel[]
}

interface ContactOrdersResult {
  phone: string
  customerName: string | null
  orders: ContactOrder[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string, locale: string, yesterdayAt: string) {
  const d = new Date(iso)
  const now = new Date()
  const tag = localeTag(locale)
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const isThisYear = d.getFullYear() === now.getFullYear()
  const hhmm = d.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })

  if (isToday) return hhmm
  if (isYesterday) return yesterdayAt.replace('{time}', hhmm)
  if (isThisYear) return `${d.toLocaleDateString(tag, { day: 'numeric', month: 'short' })} ${hhmm}`
  return `${d.toLocaleDateString(tag, { day: 'numeric', month: 'short', year: '2-digit' })} ${hhmm}`
}

function fmtTimeFull(iso: string | Date, locale = 'en') {
  return new Date(iso).toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' })
}

/**
 * Plain-language reason an outbound message did not reach the customer, or null
 * when it went through. Meta reports the cause in `metadata.delivery_error.code`
 * (WhatsApp Cloud API error codes). We translate the ones sellers actually hit
 * so a bounced confirmation never looks "sent".
 *
 * Two families the seller must not confuse:
 *   - RECIPIENT side (their customer): 131026 undeliverable, 131047 window
 *     closed, 131049/131050 recipient opted out, 130472 Meta experiment.
 *   - SENDER side (the seller's OWN WhatsApp Business account): 131042 / 141006
 *     payment-method / eligibility block — Meta stops the messages *they* start
 *     until billing is fixed. Replies still work. This is NOT the customer's
 *     fault, so it must never read like one.
 *
 * NOTE: 131026 is Meta's generic "Message undeliverable" catch-all. It usually
 * means the number isn't on WhatsApp, but Meta also uses it for terms-not-
 * accepted and transient reasons — so the wording stays "unreachable", not the
 * absolute "has no WhatsApp" that had sellers wrongly blaming customers.
 */
function failureTextForCode(code?: number | null, title?: string | null): string {
  switch (code) {
    case 131042:
    case 141006:
      // Sender-side: the seller's WhatsApp Business account needs a payment method.
      return 'Not sent — your WhatsApp account needs a payment method'
    case 131026:
      return 'Not delivered — number unreachable on WhatsApp'
    case 131047:
      return 'Not delivered — 24h window closed (needs a template)'
    case 131049:
    case 131050:
      return 'Not delivered — recipient limits these messages'
    case 130472:
      return 'Not delivered — Meta is limiting this number'
    case 131053:
      return 'Not delivered — media upload error'
    default:
      return title ? `Not delivered — ${title}` : 'Not delivered'
  }
}

function deliveryFailure(msg: WaMessage): string | null {
  if (msg.status !== 'failed') return null
  const err = msg.metadata?.delivery_error as { code?: number; title?: string } | undefined
  return failureTextForCode(err?.code, err?.title)
}

function digitsOnly(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '')
}

/** Super Admin: the owner wrote this if `from` is their number, not ours. */
function fromMatchesContact(from: string | null | undefined, contact: string | null | undefined): boolean {
  const a = digitsOnly(from)
  const b = digitsOnly(contact)
  if (!a || !b) return false
  if (a === b) return true
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  return short.length >= 9 && long.endsWith(short)
}

function bubbleIsOut(msg: WaMessage, contactPhone: string | null, platformInbox: boolean): boolean {
  if (platformInbox) return !fromMatchesContact(msg.from_phone, contactPhone)
  return msg.direction === 'outbound'
}

function groupByDate(messages: WaMessage[], locale: string, today: string, yesterdayLabel: string) {
  const groups: { label: string; messages: WaMessage[] }[] = []
  let currentLabel = ''
  const tag = localeTag(locale)

  for (const msg of messages) {
    const d = new Date(msg.timestamp)
    const now = new Date()
    let label: string
    if (d.toDateString() === now.toDateString()) label = today
    else {
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      label = d.toDateString() === yesterday.toDateString()
        ? yesterdayLabel
        : d.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' })
    }
    if (label !== currentLabel) {
      groups.push({ label, messages: [] })
      currentLabel = label
    }
    groups[groups.length - 1].messages.push(msg)
  }

  return groups
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Curated emoji set for the composer picker, grouped WhatsApp-style. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😲', '😢', '🙏'] as const
const STAR_STORAGE_KEY = 'wa_starred_ids'
const HIDE_STORAGE_KEY = 'wa_hidden_ids'

function loadIdSet(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveIdSet(key: string, ids: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...ids]))
}

function messagePlainText(msg: WaMessage): string {
  if (msg.template_preview?.body) return msg.template_preview.body
  if (msg.body && !/^🎠\s*Carousel\s*\(/i.test(msg.body)) return msg.body
  if (msg.type === 'image') return '📷 Photo'
  if (msg.type === 'video') return '🎥 Video'
  if (msg.type === 'audio') return '🎙️ Voice message'
  if (msg.type === 'document') return '📄 Document'
  if (msg.type === 'sticker') return '🎨 Sticker'
  if (msg.type === 'location') return '📍 Location'
  return msg.body || ''
}

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: ['😀','😁','😂','🤣','😊','😇','🙂','🙃','😉','😍','🥰','😘','😗','😋','😛','😜','🤪','🤨','🧐','🤓','😎','🥳','🤩','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🥱'],
  },
  {
    label: 'Gestures',
    emojis: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤝','🙏','✍️','💪','👏','🙌','👐','🤲','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','🔥','✨','⭐','🌟','💯','✅','❌','❗','❓','⚡','🎉','🎊','🎁'],
  },
  {
    label: 'Objects',
    emojis: ['📱','💻','⌨️','🖥️','📞','☎️','📷','🎥','🔋','💡','🔦','💰','💵','💳','🛒','🛍️','📦','📬','✉️','📝','📅','📌','📍','🔒','🔑','⏰','⌛','🚗','✈️','🚚','🏠','🏢','🌍','☀️','🌙','☁️','🌧️','⛄','🌈','🍕','🍔','🍟','☕','🍎','🍊','🍓','🥑','🎂','🍰','🍫','🍿'],
  },
]

function StatusTick({ status }: { status: string | null }) {
  if (status === 'failed') {
    return <Icon icon="solar:danger-triangle-bold" className="text-[13px] text-red-500" />
  }
  if (!status || status === 'sent') {
    return <Icon icon="solar:check-bold" className="text-[12px] text-[#8c8c8c]" />
  }
  if (status === 'delivered') {
    return <Icon icon="solar:check-read-linear" className="text-[14px] text-[#8c8c8c]" />
  }
  if (status === 'read') {
    return <Icon icon="solar:check-read-bold" className="text-[14px] text-[#53bdeb]" />
  }
  return null
}

/**
 * Renders WhatsApp inline formatting: *bold*, _italic_, ~strike~, ```mono```.
 * WhatsApp only applies a marker when it wraps at least one non-marker char,
 * so a lone `*` in prose is left untouched.
 */
function renderWaText(text: string) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[\s\S]+?```)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.length > 2 && part.startsWith('```') && part.endsWith('```'))
      return <code key={i} className="font-mono text-[13px]">{part.slice(3, -3)}</code>
    if (part.length > 1 && part.startsWith('*') && part.endsWith('*'))
      return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>
    if (part.length > 1 && part.startsWith('_') && part.endsWith('_'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.length > 1 && part.startsWith('~') && part.endsWith('~'))
      return <s key={i}>{part.slice(1, -1)}</s>
    return <span key={i}>{part}</span>
  })
}

/**
 * Renders an outbound template message the way the recipient saw it on
 * WhatsApp: header (image or text) → body → footer → button stack. Colours
 * inherit from the surrounding bubble so it reads on both themes.
 */
function carouselCardsOf(msg: WaMessage): WaCarouselCard[] | null {
  if (msg.template_preview?.carousel?.length) return msg.template_preview.carousel
  const meta = msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : null
  const sentByCarousel =
    meta?.sent_by === 'carousel' || String(meta?.template_name || '').startsWith('fm_carousel_')
  const raw = Array.isArray(meta?.cards) ? meta.cards : []
  if (sentByCarousel && raw.length) {
    const cards: WaCarouselCard[] = []
    for (const c of raw) {
      if (typeof c === 'string') {
        const label = c.trim()
        if (label) cards.push({ image: null, label, buttonText: 'Choose' })
        continue
      }
      if (!c || typeof c !== 'object') continue
      const o = c as { image?: unknown; label?: unknown }
      const label = String(o.label ?? '').trim()
      const image = String(o.image ?? '').trim()
      if (!label) continue
      cards.push({ image: /^https:\/\//i.test(image) ? image : null, label, buttonText: 'Choose' })
    }
    if (cards.length) return cards
  }
  const dumped = String(msg.body || '').match(/^🎠\s*Carousel\s*\(\d+\)\s*:\s*(.+)$/i)
  if (!dumped) return null
  const cards = dumped[1]
    .split(/\s*[·•\-–]\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(label => ({ image: null as string | null, label, buttonText: 'Choose' }))
  return cards.length ? cards : null
}

function carouselChoiceOf(msg: WaMessage): { label: string; index: number } | null {
  const payload = String(msg.metadata?.button_payload ?? msg.metadata?.choice_label ?? '')
  if (payload.startsWith('fmcar:')) {
    const parts = payload.split(':')
    const index = Number(parts[2])
    const label = parts.slice(3).join(':').trim()
    if (!label) return null
    return { label, index: Number.isFinite(index) ? index : -1 }
  }
  const choice = String(msg.metadata?.choice_label ?? '').trim()
  return choice ? { label: choice, index: -1 } : null
}

function ReplyQuote({
  parent,
  choice,
  isOut,
}: {
  parent?: WaMessage | null
  choice?: { label: string; index: number } | null
  isOut: boolean
}) {
  const cards = parent ? carouselCardsOf(parent) : null
  const card = choice && cards && choice.index >= 0 ? cards[choice.index] : null
  const title = card?.label || choice?.label || null
  const line = title
    ? `${card?.captionPrefix || 'Option :'} ${title}`
    : parent
      ? messagePlainText(parent).slice(0, 90)
      : null
  if (!line && !card?.image) return null

  return (
    <div
      className={`mx-2 mt-2 mb-0.5 rounded-md overflow-hidden border-l-[3px] ${
        isOut ? 'bg-black/5 border-[#1da851] dark:bg-black/20 dark:border-[#25D366]' : 'bg-black/5 border-[#667781] dark:bg-white/5 dark:border-[#8c8c8c]'
      }`}
    >
      <div className="flex items-stretch min-h-[40px]">
        <div className="flex-1 min-w-0 px-2 py-1.5">
          <p className={`text-[11px] font-semibold truncate ${isOut ? 'text-[#1da851] dark:text-[#25D366]' : 'text-[#667781] dark:text-[#aeaeae]'}`}>
            {title ? line : 'Reply'}
          </p>
          <p className="text-[12px] text-[#667781] dark:text-[#8c8c8c] truncate">
            {title ? `📷 ${line}` : line}
          </p>
        </div>
        {card?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image} alt="" className="w-11 h-11 object-cover flex-shrink-0" />
        )}
      </div>
    </div>
  )
}

function carouselBodyOf(msg: WaMessage): string {
  const previewBody = msg.template_preview?.body
  if (previewBody && !/^🎠\s*Carousel\s*\(/i.test(previewBody)) return previewBody
  if (msg.body && !/^🎠\s*Carousel\s*\(/i.test(msg.body)) return msg.body
  return "Voici les options disponibles. Appuyez sur *Choose* sous l'option que vous préférez 👇"
}

function convoPreviewText(raw: string | null): string {
  if (!raw) return '📎 Attachment'
  const dumped = raw.match(/^🎠\s*Carousel\s*\(\d+\)\s*:\s*(.+)$/i)
  if (dumped) return `🎠 ${dumped[1].replace(/\s*-\s*/g, ' · ')}`
  return raw
}

/**
 * Meta-style WhatsApp carousel: square image, option caption, green Choose
 * reply — a horizontal strip with the next card peeking.
 */
function CarouselStrip({
  cards,
  onOpenImage,
}: {
  cards: WaCarouselCard[]
  onOpenImage?: (src: string) => void
}) {
  const [broken, setBroken] = useState<Set<number>>(() => new Set())
  return (
    <div
      className="mt-1.5 w-full min-w-0 max-w-full flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {cards.map((card, i) => {
        const showImage = !!card.image && !broken.has(i)
        return (
        <div
          key={`${card.label}-${i}`}
          className="w-[188px] sm:w-[204px] shrink-0 snap-start rounded-2xl overflow-hidden bg-white dark:bg-[#1f2c34] shadow-md border border-black/5 dark:border-white/10"
        >
          <button
            type="button"
            disabled={!showImage}
            onClick={() => showImage && card.image && onOpenImage?.(card.image)}
            className="relative block w-full aspect-square bg-[#d1d7db] dark:bg-[#0b141a]"
          >
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.image!}
                alt={card.label}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setBroken(prev => new Set(prev).add(i))}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-[28px] font-semibold text-white/80 bg-gradient-to-br from-[#667781] to-[#3b4a54]">
                {card.label.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
          <div className="px-3 py-2 min-h-[44px] bg-[#111b21] dark:bg-[#111b21]">
            <p className="text-[13px] leading-snug text-white line-clamp-2">
              {card.captionPrefix || 'Option :'} {card.label}
            </p>
          </div>
          <div className="border-t border-white/10 bg-[#111b21] dark:bg-[#111b21] px-3 py-2.5 flex items-center justify-center gap-1.5">
            <Icon icon="solar:reply-bold" className="text-[15px] text-[#25D366] -scale-x-100" />
            <span className="text-[14px] font-medium text-[#25D366]">{card.buttonText || 'Choose'}</span>
          </div>
        </div>
        )
      })}
    </div>
  )
}

function TemplateBubble({ preview }: { preview: WaTemplatePreview }) {
  const dir = preview.rtl ? 'rtl' : 'ltr'
  const textAlign = preview.rtl ? 'text-right' : 'text-left'
  const fontStyle = preview.rtl
    ? { fontFamily: '"Tajawal", "Cairo", "Noto Naskh Arabic", system-ui, sans-serif' as const }
    : undefined

  const buttons: WaTemplateButton[] =
    preview.buttons && preview.buttons.length
      ? preview.buttons
      : preview.buttonText
        ? [{ type: 'URL', text: preview.buttonText, url: preview.buttonUrl }]
        : []

  const btnIcon = (t: WaTemplateButton['type']): string | null =>
    t === 'URL' ? 'solar:square-top-down-linear'
      : t === 'PHONE_NUMBER' ? 'solar:phone-linear'
        : t === 'COPY_CODE' ? 'solar:copy-linear'
          : null // QUICK_REPLY shows no icon on WhatsApp

  return (
    <div className="flex flex-col min-w-[230px]">
      {preview.headerImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.headerImageUrl}
          alt=""
          className="w-full max-h-[260px] object-cover rounded-t-[7px] bg-black/5 dark:bg-white/5"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="px-3 pt-2">
        {preview.headerText && (
          <p dir={dir} style={fontStyle} className={`mb-1 text-[15.5px] font-semibold leading-snug break-words ${textAlign}`}>
            {renderWaText(preview.headerText)}
          </p>
        )}
        <p
          dir={dir}
          lang={preview.language}
          style={fontStyle}
          className={`whitespace-pre-wrap break-words text-[14.2px] leading-[1.4] ${textAlign}`}
        >
          {renderWaText(preview.body)}
        </p>
        {preview.footerText && (
          <p dir={dir} style={fontStyle} className={`mt-1.5 text-[12px] text-[#667781] dark:text-[#8c8c8c] ${textAlign}`}>
            {renderWaText(preview.footerText)}
          </p>
        )}
      </div>
      {buttons.length > 0 && (
        <div className="mt-2">
          {buttons.map((b, i) => {
            const icon = btnIcon(b.type)
            const inner = (
              <>
                {icon && <Icon icon={icon} className="text-[17px] flex-shrink-0" />}
                <span className="truncate">{b.text}</span>
              </>
            )
            const cls =
              'border-t border-black/10 dark:border-white/10 px-3 py-2.5 flex items-center justify-center gap-2 text-[14px] font-medium text-[#0096DE] dark:text-[#53bdeb]'
            return b.type === 'URL' && b.url ? (
              <a
                key={i}
                href={b.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`${cls} hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors`}
              >
                {inner}
              </a>
            ) : (
              <div key={i} className={`${cls} cursor-default select-none`}>
                {inner}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const AVATAR_GRADIENTS = [
  'from-[#25D366] to-[#128C7E]',
  'from-[#7c3aed] to-[#5b21b6]',
  'from-[#2563eb] to-[#1d4ed8]',
  'from-[#db2777] to-[#be185d]',
  'from-[#d97706] to-[#b45309]',
  'from-[#0891b2] to-[#0e7490]',
  'from-[#16a34a] to-[#15803d]',
  'from-[#dc2626] to-[#b91c1c]',
]

const WA_BASE = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-business'

function inboxAvatarSrc(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('googleusercontent.com') || host.endsWith('ggpht.com')) {
      return `${WA_BASE}/api/wa/avatar?u=${encodeURIComponent(url)}`
    }
  } catch { /* keep original */ }
  return url
}

function avatarGradient(phone: string) {
  let hash = 0
  for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function getInitials(name: string | null, phone: string) {
  if (!name) return phone.slice(-2)
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

function Avatar({
  name,
  phone,
  image,
  size = 'md',
}: {
  name: string | null
  phone: string
  image?: string | null
  size?: 'md' | 'lg'
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [image])
  const box = size === 'lg' ? 'w-24 h-24 text-[28px]' : 'w-10 h-10 text-[13px]'
  if (image && !broken) {
    return (
      <img
        src={inboxAvatarSrc(image)}
        alt=""
        onError={() => setBroken(true)}
        className={`${box} rounded-full object-cover flex-shrink-0 bg-[#e9edef] dark:bg-[#2a2a2a] select-none`}
      />
    )
  }
  return (
    <div
      className={`${box} rounded-full bg-gradient-to-br ${avatarGradient(phone)} flex items-center justify-center flex-shrink-0 font-bold text-white select-none`}
    >
      {getInitials(name, phone)}
    </div>
  )
}

// ─── Custom Audio Player ──────────────────────────────────────────────────────

function AudioPlayer({
  src,
  isOut,
  storedDuration,
  timestamp,
  status,
  compact,
}: {
  src: string
  isOut: boolean
  storedDuration?: number
  timestamp?: Date | string
  status?: string | null
  compact?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(storedDuration ?? 0)
  const [currentTime, setCurrentTime] = useState(0)

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) a.pause()
    else a.play()
  }

  const seekOnWaveform = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const seekFromTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0] || e.changedTouches[0]
    if (!touch) return
    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = pos * duration
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const safeDuration = isFinite(duration) && duration > 0 ? duration : 0
  const display = playing || currentTime > 0
    ? fmtDuration(Math.floor(currentTime))
    : safeDuration > 0 ? fmtDuration(Math.floor(safeDuration))
    : storedDuration ? fmtDuration(storedDuration)
    : '0:00'

  // Stable pseudo-random waveform — mix of sine harmonics seeded by src.
  const seed = src.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 1)
  const bars = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39
    const envelope = Math.sin(t * Math.PI) * 0.6 + 0.4
    const wave =
      Math.abs(Math.sin(seed * 0.003 + i * 0.7)) * 0.5 +
      Math.abs(Math.sin(seed * 0.007 + i * 1.3)) * 0.3 +
      Math.abs(Math.sin(seed * 0.011 + i * 2.1)) * 0.2
    return Math.max(0.08, Math.min(1, wave * envelope))
  })

  const filledBars = Math.round((progress / 100) * bars.length)

  return (
    <div className={compact ? 'flex items-center gap-2.5 px-3 py-1.5 w-full' : 'flex items-start gap-2.5 px-2.5 py-2.5 w-[290px]'}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={e => {
          const d = (e.target as HTMLAudioElement).duration
          if (isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
      />

      <div className={`${compact ? '' : 'h-9 '}flex items-center flex-shrink-0`}>
        <button
          onClick={toggle}
          className={`${compact ? 'w-7 h-7' : 'w-10 h-10'} rounded-full flex items-center justify-center shadow transition-all active:scale-95 ${
            isOut ? 'bg-[#25D366] hover:bg-[#1da851]' : 'bg-[#54656f] dark:bg-[#8c8c8c] hover:opacity-80'
          }`}
        >
          <Icon
            icon={playing ? 'solar:pause-bold' : 'solar:play-bold'}
            className="text-white"
            style={{ fontSize: compact ? 14 : 17, marginLeft: playing ? 0 : 2 }}
          />
        </button>
      </div>

      <div
        className={`flex-1 flex items-center gap-[2px] cursor-pointer touch-none min-w-0 ${compact ? 'h-7' : 'hidden'}`}
        onClick={seekOnWaveform}
        onTouchStart={seekFromTouch}
        onTouchMove={seekFromTouch}
      >
        {compact && bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{
              height: `${Math.round(h * 100)}%`,
              minHeight: 3,
              backgroundColor: i < filledBars
                ? (isOut ? '#128C7E' : '#3b4a54')
                : (isOut ? '#4fbe7a' : '#d1d7db'),
              transition: 'background-color 0.08s',
            }}
          />
        ))}
      </div>

      {compact ? (
        <span className="text-[11px] text-[#667781] dark:text-[#8c8c8c] tabular-nums leading-none flex-shrink-0">
          {display}
        </span>
      ) : (
        <div className="flex-1 flex flex-col gap-[5px] min-w-0">
          <div
            className="flex items-center gap-[2px] h-9 cursor-pointer touch-none"
            onClick={seekOnWaveform}
            onTouchStart={seekFromTouch}
            onTouchMove={seekFromTouch}
          >
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-full"
                style={{
                  height: `${Math.round(h * 100)}%`,
                  minHeight: 3,
                  backgroundColor: i < filledBars
                    ? (isOut ? '#128C7E' : '#3b4a54')
                    : (isOut ? '#4fbe7a' : '#d1d7db'),
                  transition: 'background-color 0.08s',
                }}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] text-[#667781] dark:text-[#8c8c8c] tabular-nums leading-none">
              {display}
            </span>
            {timestamp && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <span className="text-[11px] text-[#667781] dark:text-[#8c8c8c] tabular-nums leading-none">
                  {fmtTimeFull(timestamp)}
                </span>
                {isOut && <StatusTick status={status ?? null} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Image Lightbox (tap / swipe-down to dismiss) ────────────────────────────

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef({ startY: 0, offset: 0, dragging: false })
  const [closing, setClosing] = useState(false)

  const dismiss = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 250)
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  useEffect(() => {
    const el = overlayRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      dragRef.current = { startY: e.touches[0].clientY, offset: 0, dragging: true }
    }
    const onMove = (e: TouchEvent) => {
      const d = dragRef.current
      if (!d.dragging) return
      d.offset = e.touches[0].clientY - d.startY
      if (imgRef.current) {
        imgRef.current.style.transition = 'none'
        imgRef.current.style.transform = `translateY(${d.offset}px) scale(${Math.max(0.85, 1 - Math.abs(d.offset) / 800)})`
      }
      el.style.backgroundColor = `rgba(0,0,0,${Math.max(0.3, 0.92 - Math.abs(d.offset) / 500)})`
    }
    const onEnd = () => {
      const d = dragRef.current
      d.dragging = false
      if (Math.abs(d.offset) > 120) {
        dismiss()
      } else {
        if (imgRef.current) {
          imgRef.current.style.transition = 'transform 0.25s ease'
          imgRef.current.style.transform = ''
        }
        el.style.transition = 'background-color 0.25s ease'
        el.style.backgroundColor = ''
        setTimeout(() => { el.style.transition = '' }, 250)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [dismiss])

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[300] flex items-center justify-center transition-opacity duration-200 ${closing ? 'opacity-0' : 'opacity-100'}`}
      style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
      onClick={dismiss}
    >
      <button
        onClick={e => { e.stopPropagation(); dismiss() }}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white hover:bg-white/20 transition-colors"
      >
        <Icon icon="solar:close-circle-bold" className="text-2xl" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt="Full size"
        className="max-w-[95vw] max-h-[90vh] object-contain select-none transition-transform duration-200"
        onClick={e => e.stopPropagation()}
        draggable={false}
      />
    </div>
  )
}

function MessageActionSheet({
  msg,
  starred,
  onReact,
  onReply,
  onForward,
  onCopy,
  onStar,
  onDelete,
  onClose,
}: {
  msg: WaMessage
  starred: boolean
  onReact: (emoji: string) => void
  onReply: () => void
  onForward: () => void
  onCopy: () => void
  onStar: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const [moreEmoji, setMoreEmoji] = useState(false)
  const isOut = msg.direction === 'outbound'
  const preview = messagePlainText(msg)

  const actions: { key: string; label: string; icon: string; danger?: boolean; onClick: () => void }[] = [
    { key: 'reply', label: 'Reply', icon: 'solar:reply-bold', onClick: onReply },
    { key: 'forward', label: 'Forward', icon: 'solar:forward-2-bold', onClick: onForward },
    { key: 'copy', label: 'Copy', icon: 'solar:copy-bold', onClick: onCopy },
    { key: 'star', label: starred ? 'Unstar' : 'Star', icon: starred ? 'solar:star-bold' : 'solar:star-line-duotone', onClick: onStar },
    { key: 'delete', label: 'Delete', icon: 'solar:trash-bin-trash-bold', danger: true, onClick: onDelete },
  ]

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-8"
      style={{ backgroundColor: 'rgba(11,20,26,0.48)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[300px] flex flex-col items-stretch gap-2.5"
        onClick={e => e.stopPropagation()}
      >
        <div className="self-center flex items-center gap-0.5 pl-1.5 pr-1 py-1 rounded-full bg-white/95 dark:bg-[#2a2a2a] shadow-[0_8px_28px_rgba(0,0,0,0.28)]">
          {QUICK_REACTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              className="w-10 h-10 text-[26px] leading-none flex items-center justify-center active:scale-125 transition-transform"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMoreEmoji(v => !v)}
            aria-label="More reactions"
            className={`w-8 h-8 mr-1 rounded-full flex items-center justify-center ${moreEmoji ? 'bg-[#25D366]/20 text-[#25D366]' : 'bg-black/8 dark:bg-white/10 text-[#54656f] dark:text-[#aeaeae]'}`}
          >
            <Icon icon="ic:round-add" className="text-[20px]" />
          </button>
        </div>

        {moreEmoji && (
          <div className="max-h-[180px] overflow-y-auto rounded-2xl bg-white dark:bg-[#1e1e1e] shadow-lg p-2">
            {EMOJI_GROUPS.map(group => (
              <div key={group.label}>
                <p className="px-1.5 pt-1 pb-0.5 text-[11px] font-medium text-[#667781] dark:text-[#8c8c8c] sticky top-0 bg-white dark:bg-[#1e1e1e]">
                  {group.label}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emojis.map((emoji, i) => (
                    <button
                      key={`${group.label}-${i}`}
                      type="button"
                      onClick={() => onReact(emoji)}
                      className="h-8 w-full rounded-lg text-[20px] leading-none flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          className={`self-stretch rounded-lg shadow-sm px-3 py-2 text-[14px] leading-[1.4] ${
            isOut
              ? 'bg-[#d9fdd3] text-[#111111] dark:bg-[#144d37] dark:text-[#e9edef]'
              : 'bg-white dark:bg-[#202020] text-[#111111] dark:text-[#e9edef]'
          }`}
        >
          <p className="line-clamp-4 whitespace-pre-wrap break-words">{preview || '📎 Attachment'}</p>
        </div>

        <div className="rounded-[18px] overflow-hidden bg-[#f2f2f7]/95 dark:bg-[#2a2a2a] shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
          {actions.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`w-full flex items-center gap-3 px-4 py-[13px] text-left text-[16px] ${
                i > 0 ? 'border-t border-black/8 dark:border-white/10' : ''
              } ${item.danger ? 'text-[#e11d48]' : 'text-[#111111] dark:text-[#e9edef]'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Icon icon={item.icon} className={`text-[20px] ${item.danger ? 'text-[#e11d48]' : 'text-[#3b4a54] dark:text-[#aeaeae]'}`} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ForwardPicker({
  conversations,
  onPick,
  onClose,
}: {
  conversations: Conversation[]
  onPick: (phone: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = conversations.filter(c => {
    if (!needle) return true
    return (c.contactName || '').toLowerCase().includes(needle) || c.phone.includes(needle.replace(/\D/g, ''))
  })

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]"
      style={{ backgroundColor: 'rgba(11,20,26,0.48)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl overflow-hidden bg-white dark:bg-[#1e1e1e] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[#e9edef] dark:border-[#2a2a2a] flex items-center justify-between">
          <p className="text-[16px] font-semibold text-[#111111] dark:text-[#e9edef]">Forward to…</p>
          <button type="button" onClick={onClose} className="text-[#667781]">
            <Icon icon="solar:close-circle-bold" className="text-xl" />
          </button>
        </div>
        <div className="px-3 py-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-xl bg-[#f0f2f5] dark:bg-[#2a2a2a] px-3 py-2 text-[14px] outline-none text-[#111111] dark:text-[#e9edef]"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {list.map(c => (
            <button
              key={c.phone}
              type="button"
              onClick={() => onPick(c.phone)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="w-9 h-9 rounded-full bg-[#25D366] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">
                {(c.contactName || c.phone).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#111111] dark:text-[#e9edef] truncate">
                  {c.contactName || c.phone}
                </span>
                <span className="block text-[12px] text-[#667781] truncate">{c.phone}</span>
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-[#667781]">No chats match</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#1a1a1a] select-none">
      <div className="flex flex-col items-center gap-4 opacity-70">
        <div className="w-24 h-24 rounded-full bg-[#25D366]/10 flex items-center justify-center">
          <Icon icon="logos:whatsapp-icon" className="text-5xl" />
        </div>
        <div className="text-center">
          <h2 className="text-[22px] font-light text-[#41525d] dark:text-[#aeaeae] mb-1">{title}</h2>
          <p className="text-[14px] text-[#667781] dark:text-[#8c8c8c] max-w-xs">
            {hint}
          </p>
        </div>
      </div>
    </div>
  )
}

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// A single order's confirmation / delivery state → label + pill colours.
// `confirmation_status` drives the primary badge (the call-center funnel); the
// fulfillment/delivery state rides alongside when Shopify/OMS has set it.
function badgeTone(kind: 'confirmation' | 'fulfillment' | 'financial', value: string): string {
  const v = value.toLowerCase()
  const green = 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  const amber = 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  const red = 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  const blue = 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  const grey = 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
  if (['delivered', 'confirmed', 'paid', 'fulfilled', 'completed'].includes(v)) return green
  if (['cancelled', 'canceled', 'refunded', 'returned', 'no_reply', 'no reply', 'wrong', 'failed', 'refused'].includes(v)) return red
  if (['shipped', 'in_transit', 'in transit', 'out_for_delivery', 'dispatched', 'ready'].includes(v)) return blue
  if (['pending', 'new', 'unfulfilled', 'processing', 'to_confirm', 'reported'].includes(v)) return amber
  return grey
}

function prettyStatus(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function OrderStatusBadge({ kind, value }: { kind: 'confirmation' | 'fulfillment' | 'financial'; value: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${badgeTone(kind, value)}`}>
      {prettyStatus(value)}
    </span>
  )
}

function OrderTimeline({
  history,
  parcels,
  deliveryHistory,
}: {
  history: ContactStatusEvent[]
  parcels: ContactParcel[]
  deliveryHistory: ContactStatusEvent[]
}) {
  return (
    <div className="space-y-3 mb-2.5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8696a0] dark:text-[#8c8c8c] mb-1.5 flex items-center gap-1">
          <Icon icon="solar:check-circle-bold-duotone" className="text-[12px] text-[#7066d5]" />
          Confirmation
        </p>
        {history.length === 0 ? (
          <p className="text-[11.5px] text-[#8696a0] dark:text-[#8c8c8c] px-0.5">No confirmation changes yet.</p>
        ) : (
          <ol className="relative ms-2 border-s border-[#e9edef] dark:border-[#2a2a2a] space-y-2.5 ps-3">
            {history.map((entry, i) => (
              <li key={entry.id} className="relative">
                <span
                  className={`absolute -start-[19px] top-1.5 w-2 h-2 rounded-full ${
                    i === history.length - 1 ? 'bg-[#7066d5]' : 'bg-[#c4c8cc] dark:bg-[#555]'
                  }`}
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[#7066d5]/10 text-[#5b52b5] dark:text-[#b7b0ef]">
                    {entry.toLabel || prettyStatus(entry.toStatus)}
                  </span>
                  {entry.fromLabel && (
                    <span className="text-[10.5px] text-[#8696a0]">from {entry.fromLabel}</span>
                  )}
                </div>
                {entry.note && (
                  <p className="text-[11px] text-[#667781] dark:text-[#aeaeae] italic mt-0.5">“{entry.note}”</p>
                )}
                <p className="text-[10.5px] text-[#8696a0] dark:text-[#8c8c8c] mt-0.5">
                  {fmtDateTime(entry.createdAt)}
                  {entry.changedBy ? ` · ${entry.changedBy}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8696a0] dark:text-[#8c8c8c] mb-1.5 flex items-center gap-1">
          <Icon icon="solar:delivery-bold-duotone" className="text-[12px] text-emerald-500" />
          Parcels
        </p>
        {parcels.length === 0 && deliveryHistory.length === 0 ? (
          <p className="text-[11.5px] text-[#8696a0] dark:text-[#8c8c8c] px-0.5">No parcel yet.</p>
        ) : (
          <ol className="relative ms-2 border-s border-[#e9edef] dark:border-[#2a2a2a] space-y-2.5 ps-3">
            {parcels.map(s => (
              <li key={s.id} className="relative">
                <span className="absolute -start-[19px] top-1.5 w-2 h-2 rounded-full bg-purple-500" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">
                    Parcel {s.status === 'created' ? 'created' : prettyStatus(s.status)}
                  </span>
                  {s.companyName && (
                    <span className="text-[11px] text-[#667781] dark:text-[#aeaeae]">{s.companyName}</span>
                  )}
                </div>
                {s.trackingNumber && (
                  <p className="text-[12px] font-mono font-semibold text-purple-700 dark:text-purple-300 mt-0.5">
                    {s.trackingNumber}
                  </p>
                )}
                <p className="text-[10.5px] text-[#8696a0] dark:text-[#8c8c8c] mt-0.5">{fmtDateTime(s.createdAt)}</p>
              </li>
            ))}
            {deliveryHistory.map(entry => (
              <li key={entry.id} className="relative">
                <span className="absolute -start-[19px] top-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {entry.toLabel || prettyStatus(entry.toStatus)}
                  </span>
                  {entry.fromLabel && (
                    <span className="text-[10.5px] text-[#8696a0]">from {entry.fromLabel}</span>
                  )}
                </div>
                {entry.note && (
                  <p className="text-[11px] text-[#667781] dark:text-[#aeaeae] italic mt-0.5">“{entry.note}”</p>
                )}
                <p className="text-[10.5px] text-[#8696a0] dark:text-[#8c8c8c] mt-0.5">
                  {fmtDateTime(entry.createdAt)}
                  {entry.changedBy ? ` · ${entry.changedBy}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

/**
 * Slide-in "Order details" panel opened from the chat header. Presentational —
 * the parent owns the data fetch (SWR) so the hooks stay in the main component.
 */
function OrderDetailsPanel({
  open,
  onClose,
  data,
  loading,
  phone,
  fallbackName,
  sendingOrderId,
  onSendVariants,
}: {
  open: boolean
  onClose: () => void
  data?: ContactOrdersResult
  loading: boolean
  phone: string
  fallbackName: string | null
  sendingOrderId: string | null
  onSendVariants: (orderId: string) => void
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const orders = data?.orders ?? []
  const name = data?.customerName || fallbackName
  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        onClick={onClose}
        className={`absolute inset-0 z-20 bg-black/20 transition-opacity md:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`absolute top-0 bottom-0 end-0 z-30 w-full md:w-[380px] bg-[#f0f2f5] dark:bg-[#111111] border-s border-[#e9edef] dark:border-[#2a2a2a] shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* Panel header */}
        <div className="px-4 py-3 flex items-center gap-3 bg-[#f0f2f5] dark:bg-[#202020] border-b border-[#e9edef] dark:border-[#2a2a2a] flex-shrink-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 -ms-1 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-[#2a2a2a] text-[#54656f] dark:text-[#aeaeae]"
          >
            <Icon icon="solar:close-circle-linear" className="text-2xl" />
          </button>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-[#1c1c1c] dark:text-[#e9edef] truncate">
              {name || `+${phone}`}
            </p>
            <p className="text-[12px] text-[#667781] dark:text-[#8c8c8c]">
              {orders.length > 0
                ? `${orders.length} order${orders.length > 1 ? 's' : ''}`
                : loading
                  ? 'Loading…'
                  : 'No orders'}
            </p>
          </div>
        </div>

        {/* Panel body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {loading && orders.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Icon icon="svg-spinners:ring-resize" className="text-2xl text-[#25D366]" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6 gap-3">
              <div className="w-14 h-14 rounded-full bg-[#25D366]/10 flex items-center justify-center">
                <Icon icon="solar:bag-3-bold-duotone" className="text-3xl text-[#25D366]" />
              </div>
              <p className="text-[13px] text-[#667781] dark:text-[#8c8c8c]">
                No orders found for this number yet.
              </p>
            </div>
          ) : (
            orders.map(o => (
              <div
                key={o.id}
                className="bg-white dark:bg-[#202020] rounded-xl border border-[#e9edef] dark:border-[#2a2a2a] p-3.5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[14px] font-semibold text-[#1c1c1c] dark:text-[#e9edef]">{o.name}</span>
                  <span className="text-[14px] font-semibold text-[#1c1c1c] dark:text-[#e9edef]">
                    {fmtMoney(o.total, o.currency)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  <OrderStatusBadge kind="confirmation" value={o.confirmation} />
                  {o.fulfillment && <OrderStatusBadge kind="fulfillment" value={o.fulfillment} />}
                  <OrderStatusBadge kind="financial" value={o.financial} />
                  {o.archived && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400">
                      Archived
                    </span>
                  )}
                </div>

                {o.variants && (
                  <div className="mb-2.5">
                    <p className="text-[11px] font-semibold text-[#667781] dark:text-[#8c8c8c] mb-1.5">
                      Send variants
                    </p>
                    <button
                      type="button"
                      onClick={() => onSendVariants(o.id)}
                      disabled={sendingOrderId === o.id}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                    >
                      <Icon
                        icon={sendingOrderId === o.id ? 'svg-spinners:ring-resize' : 'solar:gallery-wide-bold'}
                        className="text-[15px]"
                      />
                      Send variants
                      <span className="font-medium text-emerald-600/70 dark:text-emerald-400/70">
                        ({o.variants.cardCount})
                      </span>
                    </button>
                  </div>
                )}

                {o.items.length > 0 && (
                  <ul className="space-y-2 mb-2.5">
                    {o.items.map((it, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        {it.image ? (
                          <button
                            type="button"
                            onClick={() => setPreviewSrc(it.image!)}
                            className="flex-shrink-0 rounded-lg overflow-hidden ring-1 ring-[#e9edef] dark:ring-[#2a2a2a] hover:ring-[#25D366]/50"
                          >
                            <img src={it.image} alt={it.title} className="w-12 h-12 object-cover" />
                          </button>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-[#f0f2f5] dark:bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
                            <Icon icon="solar:box-bold" className="text-lg text-[#c4c8cc] dark:text-[#555]" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] text-[#3b4a54] dark:text-[#d1d7db] leading-snug">
                            <span className="text-[#667781] dark:text-[#8c8c8c]">{it.qty}×</span> {it.title}
                          </p>
                          {it.variant && (
                            <p className="text-[12px] font-medium text-[#1c1c1c] dark:text-[#e9edef] mt-0.5">
                              {it.variant}
                            </p>
                          )}
                          {it.sku && (
                            <p className="text-[10.5px] text-[#8696a0] dark:text-[#8c8c8c] mt-0.5">SKU: {it.sku}</p>
                          )}
                        </div>
                        {it.price != null && (
                          <span className="text-[12px] text-[#667781] dark:text-[#8c8c8c] flex-shrink-0">
                            {fmtMoney(it.price, o.currency)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <OrderTimeline
                  history={(o.statusHistory ?? []).filter(h => h.type === 'confirmation')}
                  parcels={o.parcels ?? []}
                  deliveryHistory={(o.statusHistory ?? []).filter(h => h.type === 'company')}
                />

                <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#667781] dark:text-[#8c8c8c] pt-1 border-t border-[#f0f2f5] dark:border-[#2a2a2a]">
                  <span className="flex items-center gap-1">
                    <Icon icon="solar:calendar-minimalistic-linear" className="text-[13px]" />
                    {fmtDate(o.createdAt)}
                  </span>
                  {(o.city || o.province) && (
                    <span className="flex items-center gap-1 truncate">
                      <Icon icon="solar:map-point-linear" className="text-[13px]" />
                      {[o.city, o.province].filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>

                {o.note && (
                  <p className="mt-2 text-[12px] text-[#667781] dark:text-[#8c8c8c] italic border-t border-[#f0f2f5] dark:border-[#2a2a2a] pt-2">
                    {o.note}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        {previewSrc && (
          <button
            type="button"
            onClick={() => setPreviewSrc(null)}
            className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
            aria-label="Close image"
          >
            <img src={previewSrc} alt="" className="max-w-full max-h-full rounded-lg object-contain" />
          </button>
        )}
      </aside>
    </>
  )
}

type OwnerContactInfo = {
  owner: null | {
    id: string; name: string; email: string; business_country: string | null
    status: string; profile_image: string | null; plan: string | null
    boutique_name: string | null; shop_domain: string | null
    whatsapp_number: string | null; whatsapp_verified: boolean
    welcome_sent: boolean; created_at: string | null; last_login_at: string | null
    connections: { shopify: boolean; whatsapp: boolean; meta: boolean }
  }
  customerOf: null | {
    owner_id: string; owner_name: string | null; owner_email: string | null
    owner_profile_image: string | null
  }
}

function fmtOwnerDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function OwnerDetailsPanel({
  open,
  onClose,
  data,
  loading,
  phone,
}: {
  open: boolean
  onClose: () => void
  data?: OwnerContactInfo
  loading: boolean
  phone: string
}) {
  const owner = data?.owner
  const customerOf = data?.customerOf
  return (
    <>
      <div
        onClick={onClose}
        className={`absolute inset-0 z-20 bg-black/20 transition-opacity md:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`absolute top-0 bottom-0 end-0 z-30 w-full md:w-[320px] bg-[#f0f2f5] dark:bg-[#111111] border-s border-[#e9edef] dark:border-[#2a2a2a] shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <div className="px-4 py-3 flex items-center gap-3 bg-white dark:bg-[#202020] border-b border-[#e9edef] dark:border-[#2a2a2a] flex-shrink-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 -ms-1 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-[#2a2a2a] text-[#54656f] dark:text-[#aeaeae]"
          >
            <Icon icon="solar:close-circle-linear" className="text-2xl" />
          </button>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-[#1c1c1c] dark:text-[#e9edef]">Owner details</p>
            <p className="text-[12px] text-[#667781] dark:text-[#8c8c8c] font-mono truncate">+{phone}</p>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && !owner && !customerOf ? (
            <div className="flex items-center justify-center py-12">
              <Icon icon="svg-spinners:ring-resize" className="text-2xl text-[#25D366]" />
            </div>
          ) : owner ? (
            <div className="p-4 space-y-4">
              <div className="flex flex-col items-center text-center bg-white dark:bg-[#202020] rounded-2xl px-4 py-5 border border-[#e9edef] dark:border-[#2a2a2a]">
                <Avatar name={owner.name} phone={phone} image={owner.profile_image} size="lg" />
                <p className="mt-3 text-[16px] font-semibold text-[#1c1c1c] dark:text-[#e9edef]">{owner.boutique_name || owner.name}</p>
                <p className="text-[12px] text-[#667781] dark:text-[#8c8c8c]">{owner.name}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300">
                    {owner.plan ?? 'free'}
                  </span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    owner.status === 'active'
                      ? 'bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300'
                      : 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300'
                  }`}>
                    {owner.status}
                  </span>
                </div>
              </div>
              <div className="bg-white dark:bg-[#202020] rounded-2xl border border-[#e9edef] dark:border-[#2a2a2a] divide-y divide-[#f0f2f5] dark:divide-[#2a2a2a]">
                {[
                  { label: 'Email', value: owner.email },
                  { label: 'WhatsApp', value: owner.whatsapp_number ? `+${owner.whatsapp_number.replace(/\D/g, '')}` : `+${phone}` },
                  { label: 'Country', value: (owner.business_country || '—').toUpperCase() },
                  { label: 'Verified', value: owner.whatsapp_verified ? 'Yes' : 'No' },
                  { label: 'Welcome sent', value: owner.welcome_sent ? 'Yes' : 'No' },
                  { label: 'Signed up', value: fmtOwnerDate(owner.created_at) },
                  { label: 'Last login', value: fmtOwnerDate(owner.last_login_at) },
                ].map(row => (
                  <div key={row.label} className="px-4 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-[#8696a0]">{row.label}</p>
                    <p className="text-[13px] text-[#1c1c1c] dark:text-[#e9edef] break-all">{row.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white dark:bg-[#202020] rounded-2xl border border-[#e9edef] dark:border-[#2a2a2a] px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-[#8696a0] mb-2">Connections</p>
                <div className="flex items-center gap-3 text-[12px] text-[#54656f] dark:text-[#aeaeae]">
                  <span className={owner.connections.shopify ? 'text-[#25D366] font-medium' : 'opacity-40'}>Shopify</span>
                  <span className={owner.connections.whatsapp ? 'text-[#25D366] font-medium' : 'opacity-40'}>WhatsApp</span>
                  <span className={owner.connections.meta ? 'text-[#25D366] font-medium' : 'opacity-40'}>Meta</span>
                </div>
              </div>
              <a
                href={`${(typeof window !== 'undefined' && window.location.ancestorOrigins?.[0]) || 'https://platform.flash-manager.com'}/admin/owners?email=${encodeURIComponent(owner.email)}`}
                target="_top"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white dark:bg-[#202020] border border-[#d1d7db] dark:border-[#2a2a2a] text-[13px] font-medium text-[#1c1c1c] dark:text-[#e9edef]"
              >
                Open in Owners
                <Icon icon="solar:arrow-right-up-bold" className="text-sm" />
              </a>
            </div>
          ) : customerOf ? (
            <div className="p-6 text-center">
              <p className="text-[14px] font-medium text-[#1c1c1c] dark:text-[#e9edef]">Customer of</p>
              <p className="text-[13px] text-[#667781]">{customerOf.owner_name || customerOf.owner_email}</p>
            </div>
          ) : (
            <div className="p-6 text-center">
              <p className="text-[14px] font-medium text-[#1c1c1c] dark:text-[#e9edef]">No owner attached</p>
              <p className="text-[12px] text-[#667781]">This WhatsApp number is not linked to a registered owner.</p>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface InboxProps {
  /** Signed ticket that lets <img>/<video> pull media through our proxy. */
  mediaTicket: string
  /** The seller's connected number, shown in the header. */
  connectedPhone?: string | null
  /** Still sending from the shared FlashManager number, which is sunsetting. */
  sharedNumber?: boolean
  /** Meta's verdict on the number; null on the shared number. */
  health?: WhatsAppHealth | null
  /** Opens the post-connect summary that explains the verdict. */
  onOpenHealth?: () => void
  /** Opens the connect/reconnect screen. */
  onOpenSettings: () => void
  /** Super Admin platform inbox — hide seller settings / sunset. */
  platformInbox?: boolean
  addToast: (type: 'error' | 'success', message: string) => void
}

export default function Inbox({
  mediaTicket,
  connectedPhone,
  sharedNumber,
  health,
  onOpenHealth,
  onOpenSettings,
  platformInbox = false,
  addToast,
}: InboxProps) {
  const { t, locale } = useI18n()
  const [activePhone, setActivePhone] = useState<string | null>(null)
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('phone') || ''
    const digits = raw.replace(/\D/g, '')
    if (digits.length >= 8) setActivePhone(digits)
  }, [])
  const [search, setSearch] = useState('')
  const [convoFilter, setConvoFilter] = useState<ConvoFilter>('all')
  const [connFilters, setConnFilters] = useState<Set<ConnFilter>>(new Set())
  const [messageText, setMessageText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [composerFocusTick, setComposerFocusTick] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const convoListRef = useRef<HTMLDivElement>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [showOrders, setShowOrders] = useState(false)
  const [sendingVariantsId, setSendingVariantsId] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Media attachment state
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null)
  const [mediaCaption, setMediaCaption] = useState('')
  const [mediaUploading, setMediaUploading] = useState(false)
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const sendingMediaRef = useRef(false)
  const sendMediaRef = useRef<() => Promise<void>>(async () => {})
  const cancelMediaRef = useRef<() => void>(() => {})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [actionMsg, setActionMsg] = useState<WaMessage | null>(null)
  const [replyTo, setReplyTo] = useState<WaMessage | null>(null)
  const [forwardMsg, setForwardMsg] = useState<WaMessage | null>(null)
  const [starredIds, setStarredIds] = useState<Set<string>>(() => loadIdSet(STAR_STORAGE_KEY))
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => loadIdSet(HIDE_STORAGE_KEY))
  const pressRef = useRef<{ id: string; x: number; y: number; timer: number } | null>(null)
  const suppressClickRef = useRef(false)

  const fetcher = useCallback((path: string) => apiFetch(path).then(r => r.json()), [])
  const srcFor = useCallback((id: string) => mediaUrl(id, mediaTicket), [mediaTicket])

  const PAGE_SIZE = 50
  const getConversationsKey = useCallback(
    (pageIndex: number, previousPageData: ConversationPage | null) => {
      if (previousPageData?.pagination && !previousPageData.pagination.hasMore) return null
      const params = new URLSearchParams({
        offset: String(pageIndex * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      })
      if (search.trim()) params.set('search', search.trim())
      if (convoFilter !== 'all') params.set('filter', convoFilter)
      if (platformInbox && connFilters.size) {
        params.set('connections', [...connFilters].join(','))
      }
      return `/wa/conversations?${params.toString()}`
    },
    [search, convoFilter, platformInbox, connFilters]
  )

  const { data: convoPages, mutate: mutateConvos, size, setSize, isValidating: isConvoValidating } =
    useSWRInfinite<ConversationPage>(getConversationsKey, fetcher, {
      refreshInterval: 5000,
      revalidateFirstPage: true,
      revalidateAll: false,
    })

  // Dedupe the flattened pages by phone: SWR Infinite keeps the previous `size`
  // across key changes (filter / search), so a conversation can briefly appear
  // in two adjacent pages while later pages are still in flight.
  const conversations = (() => {
    const seen = new Set<string>()
    const out: Conversation[] = []
    for (const page of convoPages ?? []) {
      for (const c of page.conversations ?? []) {
        if (seen.has(c.phone)) continue
        seen.add(c.phone)
        out.push(c)
      }
    }
    return out
  })()

  // Counts come from the server's full unfiltered list so the badges stay
  // accurate no matter which tab is active.
  const convoCounts = convoPages?.[0]?.counts ?? { all: 0, needsReply: 0, unread: 0, sent: 0 }
  const lastConvoPage = convoPages?.[convoPages.length - 1]
  const hasMoreConvos = lastConvoPage?.pagination?.hasMore ?? false
  const isLoadingConvos = !convoPages
  const isLoadingMoreConvos = isConvoValidating && !!convoPages && size > convoPages.length

  const { data: threadData, mutate: mutateThread } = useSWR<{ messages: WaMessage[] }>(
    activePhone ? `/wa/conversations?phone=${encodeURIComponent(activePhone)}` : null,
    fetcher,
    { refreshInterval: 3000 }
  )

  const { data: contactOrders, isLoading: ordersLoading, mutate: mutateOrders } = useSWR<ContactOrdersResult>(
    activePhone && !platformInbox ? `/wa/contact-orders?phone=${encodeURIComponent(activePhone)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  )
  const { data: ownerInfo, isLoading: ownerInfoLoading } = useSWR<OwnerContactInfo>(
    activePhone && platformInbox ? `/wa/contact-info?phone=${encodeURIComponent(activePhone)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  )
  const variantOrders = (contactOrders?.orders ?? []).filter(o => o.variants)
  const latestVariantOrder = variantOrders[0] ?? null

  // Close the details panel whenever the open conversation changes.
  useEffect(() => {
    setShowOrders(false)
    setShowEmoji(false)
    setActionMsg(null)
    setReplyTo(null)
    setForwardMsg(null)
  }, [activePhone])

  useEffect(() => {
    if (!actionMsg && !forwardMsg) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionMsg(null)
        setForwardMsg(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actionMsg, forwardMsg])

  useEffect(() => {
    setSize(1)
  }, [search, convoFilter, connFilters, setSize])

  const maybeLoadMoreConversations = useCallback(() => {
    const el = convoListRef.current
    if (!el || !hasMoreConvos || isLoadingMoreConvos) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120
    if (nearBottom) setSize(s => s + 1)
  }, [hasMoreConvos, isLoadingMoreConvos, setSize])

  useEffect(() => {
    maybeLoadMoreConversations()
  }, [convoPages, maybeLoadMoreConversations])

  useEffect(() => {
    if (threadData?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [threadData?.messages?.length])

  // Scroll to the chat panel when a conversation opens (mobile CSS scroll-snap)
  useEffect(() => {
    if (!activePhone) return
    const el = scrollContainerRef.current
    if (!el || window.innerWidth >= 768) return
    requestAnimationFrame(() => {
      el.scrollTo({ left: el.clientWidth, behavior: 'smooth' })
    })
  }, [activePhone])

  // The list row is a <button>, so the browser leaves focus there after click.
  // preventDefault on mousedown + this tick puts the caret in the composer.
  useEffect(() => {
    if (!activePhone || mediaPreviewUrl) return
    let cancelled = false
    const focusComposer = () => {
      if (cancelled) return
      const el = inputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(focusComposer)
    })
    const t1 = window.setTimeout(focusComposer, 50)
    const t2 = window.setTimeout(focusComposer, 200)
    return () => {
      cancelled = true
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [activePhone, composerFocusTick, mediaPreviewUrl])

  // Detect native swipe-back via CSS scroll-snap settling.
  // iOS often never fires `scrollend`, so also debounce on `scroll`.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || window.innerWidth >= 768 || !activePhone) return

    let armed = false
    const armTimer = setTimeout(() => { armed = true }, 450)
    let settleTimer = 0

    const maybeClose = () => {
      if (armed && el.scrollLeft < el.clientWidth * 0.3) setActivePhone(null)
    }

    const onSnapSettle = () => maybeClose()
    const onScroll = () => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(maybeClose, 90)
    }

    el.addEventListener('scrollend', onSnapSettle, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scrollend', onSnapSettle)
      el.removeEventListener('scroll', onScroll)
      window.clearTimeout(settleTimer)
      clearTimeout(armTimer)
    }
  }, [activePhone])

  const activeConvo = conversations.find(c => c.phone === activePhone)
  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0)
  const visibleMessages = (() => {
    const raw = (threadData?.messages ?? []).filter(m => !hiddenIds.has(m.id))
    if (!platformInbox || !activePhone) return raw
    const seen = new Set<string>()
    const out: WaMessage[] = []
    for (const m of raw) {
      const aligned: WaMessage = {
        ...m,
        direction: fromMatchesContact(m.from_phone, activePhone) ? 'inbound' : 'outbound',
      }
      const bucket = Math.floor(new Date(aligned.timestamp).getTime() / 2000)
      const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(aligned.type)
      const key = isMedia
        ? `${aligned.type}|${bucket}`
        : `text|${(aligned.body || '').trim().slice(0, 80)}|${bucket}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(aligned)
    }
    return out
  })()
  const groups = visibleMessages.length
    ? groupByDate(visibleMessages, locale, t('today'), t('yesterday'))
    : []
  const messagesByWamid = (() => {
    const map = new Map<string, WaMessage>()
    for (const m of visibleMessages) {
      if (m.wa_message_id) map.set(m.wa_message_id, m)
    }
    return map
  })()

  const clearPress = () => {
    if (pressRef.current?.timer) window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }

  const bindMessagePress = (msg: WaMessage) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      clearPress()
      setActionMsg(msg)
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clearPress()
      const timer = window.setTimeout(() => {
        pressRef.current = null
        suppressClickRef.current = true
        setActionMsg(msg)
      }, 420)
      pressRef.current = { id: msg.id, x: e.clientX, y: e.clientY, timer }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = pressRef.current
      if (!p || p.id !== msg.id) return
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearPress()
    },
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
  })

  const sendReaction = async (msg: WaMessage, emoji: string) => {
    setActionMsg(null)
    if (!activePhone || !msg.wa_message_id) {
      addToast('error', 'Cannot react to this message')
      return
    }
    try {
      const res = await apiFetch('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: activePhone, type: 'reaction', reactTo: msg.wa_message_id, emoji }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) throw new Error(d.error || 'Failed to send reaction')
      mutateThread()
    } catch (e: any) {
      addToast('error', e.message)
    }
  }

  const sendVariants = async (orderId: string) => {
    if (sendingVariantsId) return
    setSendingVariantsId(orderId)
    try {
      const res = await apiFetch('/wa/send-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || (!d.sent && !d.pending)) {
        throw new Error(d.error || 'Could not send variants')
      }
      addToast(
        'success',
        d.pending
          ? 'Variant cards sent. Meta is still approving the template — they may appear shortly.'
          : 'Variants sent on WhatsApp'
      )
      mutateThread()
      mutateOrders()
    } catch (e: any) {
      addToast('error', e.message)
    } finally {
      setSendingVariantsId(null)
    }
  }

  const copyMessage = async (msg: WaMessage) => {
    setActionMsg(null)
    const text = messagePlainText(msg)
    if (!text) {
      addToast('error', 'Nothing to copy')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      addToast('success', 'Copied')
    } catch {
      addToast('error', 'Could not copy')
    }
  }

  const toggleStar = (msg: WaMessage) => {
    setActionMsg(null)
    setStarredIds(prev => {
      const next = new Set(prev)
      if (next.has(msg.id)) next.delete(msg.id)
      else next.add(msg.id)
      saveIdSet(STAR_STORAGE_KEY, next)
      return next
    })
  }

  const hideMessage = (msg: WaMessage) => {
    setActionMsg(null)
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.add(msg.id)
      saveIdSet(HIDE_STORAGE_KEY, next)
      return next
    })
  }

  const forwardTo = async (phone: string) => {
    if (!forwardMsg) return
    const text = messagePlainText(forwardMsg)
    setForwardMsg(null)
    if (!text) {
      addToast('error', 'Nothing to forward')
      return
    }
    try {
      const res = await apiFetch('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, type: 'text', text }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) throw new Error(d.error || 'Failed to forward')
      addToast('success', 'Forwarded')
      if (phone === activePhone) mutateThread()
      mutateConvos()
    } catch (e: any) {
      addToast('error', e.message)
    }
  }

  const call = useWhatsAppCall({
    phone: activePhone,
    sharedNumber,
    connectedPhone,
    contactName: activeConvo?.contactName,
    addToast,
    onPermissionSent: () => { mutateThread() },
  })
  const showCallButton =
    !sharedNumber &&
    (health?.canPlaceCalls === true || call.inCall || call.state === 'waiting_permission')

  const handleSend = async () => {
    if (!messageText.trim() || !activePhone) return
    const text = messageText.trim()
    setMessageText('')
    setSending(true)
    try {
      const res = await apiFetch('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activePhone,
          type: 'text',
          text,
          ...(replyTo?.wa_message_id ? { replyTo: replyTo.wa_message_id } : {}),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) throw new Error(d.error || 'Failed to send')
      setReplyTo(null)
      mutateThread()
      mutateConvos()
    } catch (e: any) {
      addToast('error', e.message)
      setMessageText(text)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (mediaPreviewUrl && mediaFile) {
      void sendMedia()
      return
    }
    handleSend()
  }

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current
    if (!el) {
      setMessageText(t => t + emoji)
      return
    }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = el.value.slice(0, start) + emoji + el.value.slice(end)
    setMessageText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 100)}px`
    })
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        setAudioPreviewUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      recorder.start(100)
      setIsRecording(true)
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch {
      addToast('error', t('micDenied'))
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
  }

  const cancelVoice = () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl)
    setAudioBlob(null)
    setAudioPreviewUrl(null)
    setRecordingTime(0)
  }

  const sendVoice = async () => {
    if (!audioBlob || !activePhone) return
    setSending(true)
    try {
      const form = new FormData()
      form.append('file', audioBlob, audioBlob.type.includes('ogg') ? 'voice.ogg' : 'voice.webm')
      form.append('mediaType', 'audio')

      const uploadRes = await apiFetch('/wa/media/upload', { method: 'POST', body: form })
      const uploadData = await uploadRes.json().catch(() => ({}))
      if (!uploadRes.ok || !uploadData.mediaId) throw new Error(uploadData.error || 'Upload failed')

      const sendRes = await apiFetch('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: activePhone, type: 'audio', mediaId: uploadData.mediaId, duration: recordingTime }),
      })
      const sendData = await sendRes.json().catch(() => ({}))
      if (!sendRes.ok || !sendData.success) throw new Error(sendData.error || 'Send failed')

      cancelVoice()
      mutateThread()
      mutateConvos()
    } catch (e: any) {
      addToast('error', e.message)
    } finally {
      setSending(false)
    }
  }

  const handleMediaPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    if (!isImage && !isVideo) {
      addToast('error', t('onlyImagesVideos'))
      return
    }

    const maxMB = isVideo ? 16 : 5
    if (file.size > maxMB * 1024 * 1024) {
      addToast('error', t('fileTooLarge', { max: maxMB, kind: t(isVideo ? 'videos' : 'images') }))
      return
    }

    setMediaFile(file)
    setMediaPreviewUrl(URL.createObjectURL(file))
    setMediaCaption('')
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return
        if (file.size > 5 * 1024 * 1024) {
          addToast('error', t('fileTooLarge', { max: 5, kind: t('images') }))
          return
        }
        setMediaFile(file)
        setMediaPreviewUrl(URL.createObjectURL(file))
        setMediaCaption('')
        return
      }
    }
  }

  const cancelMedia = () => {
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl)
    setMediaFile(null)
    setMediaPreviewUrl(null)
    setMediaCaption('')
  }

  const sendMedia = async () => {
    if (!mediaFile || !activePhone || sendingMediaRef.current) return
    sendingMediaRef.current = true
    setMediaUploading(true)
    try {
      const mediaType = mediaFile.type.startsWith('video/') ? 'video' : 'image'

      const form = new FormData()
      form.append('file', mediaFile)
      form.append('mediaType', mediaType)

      const uploadRes = await apiFetch('/wa/media/upload', { method: 'POST', body: form })
      const uploadData = await uploadRes.json().catch(() => ({}))
      if (!uploadRes.ok || !uploadData.mediaId) throw new Error(uploadData.error || 'Upload failed')

      const sendRes = await apiFetch('/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activePhone,
          type: mediaType,
          mediaId: uploadData.mediaId,
          ...(mediaCaption.trim() ? { caption: mediaCaption.trim() } : {}),
        }),
      })
      const sendData = await sendRes.json().catch(() => ({}))
      if (!sendRes.ok || !sendData.success) throw new Error(sendData.error || 'Send failed')

      cancelMedia()
      mutateThread()
      mutateConvos()
    } catch (e: any) {
      addToast('error', e.message)
    } finally {
      sendingMediaRef.current = false
      setMediaUploading(false)
    }
  }
  sendMediaRef.current = sendMedia
  cancelMediaRef.current = cancelMedia

  useEffect(() => {
    if (!mediaPreviewUrl || !mediaFile) return
    const focusCaption = () => captionRef.current?.focus()
    const raf = requestAnimationFrame(() => requestAnimationFrame(focusCaption))
    const later = window.setTimeout(focusCaption, 60)

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelMediaRef.current()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMediaRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(later)
      window.removeEventListener('keydown', onKey)
    }
  }, [mediaPreviewUrl, mediaFile])

  const handleSelectConvo = (phone: string) => {
    setActivePhone(phone)
    setComposerFocusTick(n => n + 1)
    mutateConvos(
      prevPages => {
        if (!prevPages) return prevPages
        let wasUnread = false
        const pages = prevPages.map(page => ({
          ...page,
          conversations: page.conversations.map(c => {
            if (c.phone !== phone || !c.unread) return c
            wasUnread = true
            return { ...c, unread: 0 }
          }),
        }))
        if (wasUnread && pages[0]?.counts) {
          pages[0] = {
            ...pages[0],
            counts: { ...pages[0].counts, unread: Math.max(0, (pages[0].counts.unread ?? 0) - 1) },
          }
        }
        return pages
      },
      { revalidate: false },
    )
  }

  const goBack = useCallback(() => {
    const el = scrollContainerRef.current
    if (el && window.innerWidth < 768) {
      el.scrollTo({ left: 0, behavior: 'smooth' })
    } else {
      setActivePhone(null)
    }
  }, [])

  const consumeBack = useCallback(() => {
    if (lightboxSrc) {
      setLightboxSrc(null)
      return true
    }
    if (actionMsg) {
      setActionMsg(null)
      return true
    }
    if (forwardMsg) {
      setForwardMsg(null)
      return true
    }
    if (activePhone) {
      goBack()
      return true
    }
    return false
  }, [lightboxSrc, actionMsg, forwardMsg, activePhone, goBack])

  // Tell the host how deep we are so iOS/Android swipe-back closes the chat
  // instead of leaving the Finder embed for Dashboard.
  useEffect(() => {
    const depth = (activePhone ? 1 : 0) + (lightboxSrc || actionMsg || forwardMsg ? 1 : 0)
    try {
      window.parent?.postMessage({ source: 'fm-app', type: 'fm:nav-stack', depth }, '*')
    } catch { /* standalone */ }
  }, [activePhone, lightboxSrc, actionMsg, forwardMsg])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.source !== 'fm-host' || data.type !== 'fm:back') return
      const handled = consumeBack()
      try {
        window.parent?.postMessage(
          { source: 'fm-app', type: handled ? 'fm:back:handled' : 'fm:back:idle' },
          event.origin && event.origin !== 'null' ? event.origin : '*',
        )
      } catch { /* ignore */ }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [consumeBack])

  return (
    <>
      <style>{`
.wa-snap::-webkit-scrollbar{display:none}
.wa-snap[data-active]{overflow-x:auto!important;scroll-snap-type:x mandatory;overscroll-behavior-x:none;-webkit-overflow-scrolling:touch}
@media(min-width:768px){.wa-snap,.wa-snap[data-active]{overflow:hidden!important;scroll-snap-type:none!important}}
      `}</style>
      <div
        ref={scrollContainerRef}
        className="wa-snap fixed inset-0 flex min-w-0 w-full max-w-full overflow-hidden bg-white dark:bg-[#111111]"
        data-active={activePhone ? '' : undefined}
        style={{ zIndex: 10, WebkitTapHighlightColor: 'transparent', scrollbarWidth: 'none' }}
      >
        {/* ── Left panel — conversation list ─────────────────────────────────── */}
        <div className="h-full w-full shrink-0 snap-start flex flex-col bg-white dark:bg-[#111111] border-r border-[#e9edef] dark:border-[#2a2a2a] md:w-[380px] md:min-w-[380px] md:max-w-[380px]">
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202020] border-b border-[#e9edef] dark:border-[#2a2a2a]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[#25D366] flex items-center justify-center bg-transparent">
                <Icon icon="logos:whatsapp-icon" className="text-xl" />
              </div>
              <div>
                <span className="font-semibold text-[16px] text-[#1c1c1c] dark:text-[#e9edef]">WhatsApp</span>
                {(connectedPhone || platformInbox) && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[10px] text-[#667781] dark:text-[#8c8c8c] font-mono">
                      {platformInbox ? 'Since 30 Aug 2026' : connectedPhone}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-px rounded font-medium ${
                        platformInbox
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : sharedNumber
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {platformInbox ? t('platform') : sharedNumber ? t('shared') : t('own')}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {totalUnread > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[#25D366] text-white text-[11px] font-bold">
                  {totalUnread}
                </span>
              )}
              {!platformInbox && (
              <div className="relative group">
                <button
                  onClick={onOpenSettings}
                  className="w-9 h-9 rounded-full bg-white dark:bg-[#2a2a2a] shadow-md border border-gray-100 dark:border-[#333333] flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-gray-800 dark:text-white"
                  aria-label={t('senderSettings')}
                >
                  <Icon icon="solar:settings-bold-duotone" className="text-[18px]" />
                </button>
                <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 shadow-lg">
                  {t('senderSettings')}
                  <div className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-gray-800 dark:border-l-gray-700" />
                </div>
              </div>
              )}
            </div>
          </div>

          {/* Anything Meta hasn't cleared yet. The inbox still works — replies are
              unaffected by most of it — so this is a strip into the summary rather
              than a screen in the way. It disappears by itself once Meta is done. */}
          {!sharedNumber && health && hasActionableHealth(health) && onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className={`w-full text-left px-4 py-2.5 border-b transition-colors ${
                health.canReply
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/40 hover:bg-amber-100 dark:hover:bg-amber-950/60'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-950/60'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  icon={health.canReply ? 'solar:clock-circle-bold' : 'solar:danger-triangle-bold'}
                  className={`text-base flex-shrink-0 mt-px ${health.canReply ? 'text-amber-500' : 'text-red-500'}`}
                />
                <div className="min-w-0">
                  <p
                    className={`text-[12px] leading-snug ${
                      health.canReply ? 'text-amber-900 dark:text-amber-200' : 'text-red-900 dark:text-red-200'
                    }`}
                  >
                    {health.testNumber
                      ? 'You’re on Meta’s test number — customers can’t reach it.'
                      : !health.canReply
                        ? 'Meta is blocking messages on this number.'
                        : health.sending === 'blocked' || (health.sending === 'pending' && health.blockers.some(b => b.code !== 141010))
                          ? 'Replies work, but messages you start are blocked.'
                          : health.registration !== 'ready'
                            ? 'Meta is still activating your number.'
                            : 'Something still needs a look on Meta.'}
                  </p>
                  <span
                    className={`mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold ${
                      health.canReply ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'
                    }`}
                  >
                    {openItemCount(health) === 1 ? 'See what’s left' : `See all ${openItemCount(health)} items`}
                    <Icon icon="solar:arrow-right-linear" className="text-[13px]" />
                  </span>
                </div>
              </div>
            </button>
          )}

          {/* Shared number sunset — the inbox keeps working until the date, so
              this stays a persistent nudge rather than a blocking screen. */}
          {sharedNumber && !platformInbox && (
            <button
              onClick={onOpenSettings}
              className="w-full text-left px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <Icon icon="solar:info-circle-bold" className="text-amber-500 text-base flex-shrink-0 mt-px" />
                <div className="min-w-0">
                  <p className="text-[12px] leading-snug text-amber-900 dark:text-amber-200">
                    The shared FlashManager number stops sending on{' '}
                    <span className="font-semibold">{sunsetDateLabel()}</span>
                    <span className="font-semibold"> — {daysUntilSunset()} days left</span>.
                  </p>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                    Connect your own number
                    <Icon icon="solar:arrow-right-linear" className="text-[13px]" />
                  </span>
                </div>
              </div>
            </button>
          )}

          {/* Search */}
          <div className="px-2 py-2 bg-white dark:bg-[#111111]">
            <div className="flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#202020] rounded-lg px-3 py-2">
              <Icon icon="solar:magnifer-linear" className="text-[#54656f] dark:text-[#aeaeae] text-[16px] flex-shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="flex-1 bg-transparent text-[14px] text-[#1c1c1c] dark:text-[#e9edef] placeholder:text-[#667781] dark:placeholder:text-[#8c8c8c] outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')}>
                  <Icon icon="solar:close-circle-bold" className="text-[#54656f] dark:text-[#aeaeae]" />
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs — keeps unanswered customers visible when campaign
              blasts would otherwise bury them */}
          <div className="px-2 pb-2 bg-white dark:bg-[#111111] flex items-center gap-1 overflow-x-auto">
            {([
              { id: 'all',         label: t('filterAll'),         count: convoCounts.all },
              { id: 'needs_reply', label: t('filterNeedsReply'), count: convoCounts.needsReply },
              { id: 'unread',      label: t('filterUnread'),      count: convoCounts.unread },
              { id: 'sent',        label: t('filterSent'),        count: convoCounts.sent },
            ] as Array<{ id: ConvoFilter; label: string; count: number }>).map(tab => {
              const active = convoFilter === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => { setConvoFilter(tab.id); setSize(1) }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#25D366]/15 text-[#1da851] dark:text-[#25D366] font-semibold'
                      : 'text-[#54656f] dark:text-[#aeaeae] hover:bg-[#f0f2f5] dark:hover:bg-[#202020]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`text-[10.5px] leading-none px-1.5 py-0.5 rounded-full ${
                      active
                        ? 'bg-[#25D366] text-white'
                        : 'bg-[#e9edef] dark:bg-[#2a2a2a] text-[#54656f] dark:text-[#aeaeae]'
                    }`}>
                      {tab.count > 999 ? '999+' : tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {platformInbox && (
            <div className="px-2 pb-2 bg-white dark:bg-[#111111] flex items-center gap-1">
              {CONN_ICONS.map(p => {
                const active = connFilters.has(p.key)
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setConnFilters(prev => {
                        const next = new Set(prev)
                        if (next.has(p.key)) next.delete(p.key)
                        else next.add(p.key)
                        return next
                      })
                      setSize(1)
                    }}
                    title={active ? `Showing ${p.label} connected` : `Filter by ${p.label} connected`}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      active
                        ? 'border-[#1c1c1c] dark:border-white bg-[#1c1c1c] dark:bg-white text-white dark:text-[#111]'
                        : 'border-[#e9edef] dark:border-[#2a2a2a] text-[#667781] dark:text-[#8c8c8c] hover:border-[#ccc]'
                    }`}
                  >
                    <Icon
                      icon={p.icon}
                      className={`text-[11px] ${active ? 'text-white dark:text-[#111]' : ''}`}
                      style={active ? undefined : { color: p.color }}
                    />
                    <span>{p.label}</span>
                  </button>
                )
              })}
              {connFilters.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setConnFilters(new Set()); setSize(1) }}
                  className="px-1.5 py-1 text-[11px] text-[#667781] dark:text-[#8c8c8c] hover:text-[#1c1c1c] dark:hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Conversation list */}
          <div ref={convoListRef} onScroll={maybeLoadMoreConversations} className="flex-1 overflow-y-auto overscroll-contain">
            {isLoadingConvos ? (
              <div className="flex flex-col gap-0">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#e9edef] dark:border-[#2a2a2a]">
                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-[#2a2a2a] animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-200 dark:bg-[#2a2a2a] rounded animate-pulse w-1/2" />
                      <div className="h-2.5 bg-gray-100 dark:bg-[#202020] rounded animate-pulse w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !conversations.length ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                <Icon icon="solar:chat-dots-bold-duotone" className="text-4xl text-gray-300 dark:text-[#2a2a2a]" />
                <p className="text-[13px] text-[#667781] dark:text-[#8c8c8c]">
                  {search
                    ? t('emptySearch')
                    : convoFilter === 'unread'
                      ? t('emptyUnread')
                      : convoFilter === 'needs_reply'
                        ? t('emptyNeedsReply')
                        : convoFilter === 'sent'
                          ? t('emptySent')
                          : t('emptyNone')}
                </p>
              </div>
            ) : (
              conversations.map(c => {
                const isActive = c.phone === activePhone
                return (
                  <button
                    key={c.phone}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => handleSelectConvo(c.phone)}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-[#e9edef] dark:border-[#2a2a2a] hover:bg-[#f5f6f6] dark:hover:bg-[#202020] active:bg-[#e9edef] dark:active:bg-[#1a1a1a] transition-colors text-left select-none ${
                      isActive ? 'bg-[#f0f2f5] dark:bg-[#2a2a2a]' : ''
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <Avatar name={c.contactName} phone={c.phone} image={c.profileImage || c.productImage} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-[15px] font-medium text-[#1c1c1c] dark:text-[#e9edef] truncate flex items-center gap-1.5">
                          <span className="truncate">{c.contactName || c.phone}</span>
                          {platformInbox && <ConnectionIcons connections={c.connections} />}
                        </p>
                        <span className={`text-[11px] flex-shrink-0 ml-2 ${c.unread > 0 ? 'text-[#25D366]' : 'text-[#667781] dark:text-[#8c8c8c]'}`}>
                          {/* For threads where the customer is waiting on us, show
                              WHEN THEY WROTE — otherwise an outbound blast on top
                              of an old unread masks how stale it really is. */}
                          {fmtTime((c.unread > 0 || c.needsReply) && c.lastInboundAt ? c.lastInboundAt : c.lastTimestamp, locale, t('yesterdayAt'))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className={`text-[13px] truncate flex items-center gap-1 ${c.lastFailed ? 'text-red-500 dark:text-red-400' : 'text-[#667781] dark:text-[#8c8c8c]'}`}>
                          {c.direction === 'outbound' && (
                            c.lastFailed
                              ? <Icon icon="solar:danger-triangle-bold" className="text-[11px] text-red-500 flex-shrink-0" />
                              : <Icon icon="solar:plain-bold" className="text-[10px] text-[#25D366] flex-shrink-0" />
                          )}
                          {c.lastFailed ? failureTextForCode(c.lastFailureCode) : convoPreviewText(c.lastMessage)}
                        </p>
                        {c.unread > 0 && (
                          <span className="w-5 h-5 rounded-full bg-[#25D366] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 ml-2">
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
            {isLoadingMoreConvos && (
              <div className="px-4 py-3 text-center text-[12px] text-[#667781] dark:text-[#8c8c8c]">
                {t('loadingMore')}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel — chat area ────────────────────────────────────────── */}
        <div className="h-full w-full min-w-0 max-w-full shrink-0 snap-start flex flex-col overflow-hidden bg-white dark:bg-[#0a0a0a] md:w-auto md:flex-1 md:shrink">
          {!activePhone ? (
            <EmptyState title={t('emptyInboxTitle')} hint={t('emptyInboxHint')} />
          ) : (
            <div className="relative flex flex-col flex-1 min-w-0 overflow-hidden bg-white dark:bg-[#0a0a0a]">
              {/* Chat header */}
              <div className="px-4 py-2.5 flex items-center gap-3 bg-[#f0f2f5] dark:bg-[#0a0a0a] border-b border-[#e9edef] dark:border-[#2a2a2a]">
                <button
                  onClick={goBack}
                  className="md:hidden w-10 h-10 -ml-1 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-[#2a2a2a] active:bg-gray-300 dark:active:bg-[#1a1a1a] text-[#54656f] dark:text-[#aeaeae] flex-shrink-0"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <Icon icon="solar:alt-arrow-left-bold" className="text-2xl" />
                </button>
                <Avatar name={activeConvo?.contactName ?? null} phone={activePhone} image={activeConvo?.profileImage || activeConvo?.productImage || ownerInfo?.owner?.profile_image} />
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-medium text-[#1c1c1c] dark:text-[#e9edef] truncate">
                    {activeConvo?.contactName || activePhone}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] text-[#667781] dark:text-[#8c8c8c] font-mono">+{activePhone}</p>
                    {platformInbox && <ConnectionIcons connections={activeConvo?.connections} size="text-[12px]" />}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
                  {platformInbox && (ownerInfo?.owner?.email || ownerInfo?.customerOf?.owner_email) && (
                    <span
                      title={ownerInfo.owner?.email || ownerInfo.customerOf?.owner_email || ''}
                      className="hidden sm:block max-w-[200px] md:max-w-[240px] text-[12px] text-[#54656f] dark:text-[#aeaeae] truncate"
                    >
                      {ownerInfo.owner?.email || ownerInfo.customerOf?.owner_email}
                    </span>
                  )}
                  {showCallButton && (
                    <button
                      onClick={() => call.startCall()}
                      disabled={call.state !== 'idle' && call.state !== 'ended'}
                      title={
                        call.state === 'waiting_permission'
                          ? 'Waiting for the customer to allow the call'
                          : 'Call on WhatsApp'
                      }
                      aria-label="Call on WhatsApp"
                      className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
                        call.inCall || call.state === 'waiting_permission'
                          ? 'bg-[#25D366]/15 text-[#1fa855] dark:text-[#25D366]'
                          : 'hover:bg-gray-200 dark:hover:bg-[#2a2a2a] text-[#54656f] dark:text-[#aeaeae]'
                      } disabled:opacity-60`}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <Icon
                        icon={
                          call.state === 'checking' || call.state === 'requesting' || call.state === 'connecting'
                            ? 'svg-spinners:ring-resize'
                            : call.state === 'waiting_permission'
                              ? 'solar:hourglass-bold'
                              : 'solar:phone-bold'
                        }
                        className="text-2xl"
                      />
                    </button>
                  )}
                  {latestVariantOrder && (
                    <button
                      type="button"
                      onClick={() => {
                        if (variantOrders.length === 1) sendVariants(latestVariantOrder.id)
                        else setShowOrders(true)
                      }}
                      disabled={!!sendingVariantsId}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                      title={
                        variantOrders.length > 1
                          ? 'Several orders have variants — pick one'
                          : `Send variants (${latestVariantOrder.variants?.cardCount ?? 0})`
                      }
                      aria-label="Send variants"
                    >
                      <Icon
                        icon={sendingVariantsId ? 'svg-spinners:ring-resize' : 'solar:gallery-wide-bold'}
                        className="text-[15px]"
                      />
                      <span className="hidden sm:inline">Send variants</span>
                    </button>
                  )}
                <button
                  onClick={() => setShowOrders(v => !v)}
                  aria-label={platformInbox ? 'Owner details' : 'Order details'}
                  aria-pressed={showOrders}
                  className={`w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-colors ${
                    showOrders
                      ? 'bg-[#25D366]/15 text-[#1fa855] dark:text-[#25D366]'
                      : 'hover:bg-gray-200 dark:hover:bg-[#2a2a2a] text-[#54656f] dark:text-[#aeaeae]'
                  }`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <Icon icon="solar:menu-dots-bold" className="text-2xl" />
                </button>
                </div>
              </div>

              {(call.inCall || call.state === 'waiting_permission') && (
                <div className="px-4 py-2 flex items-center gap-3 bg-[#1fa855] text-white">
                  <Icon
                    icon={call.state === 'connected' ? 'solar:phone-calling-bold' : 'solar:phone-bold'}
                    className={`text-lg flex-shrink-0 ${call.state === 'ringing' || call.state === 'connecting' ? 'animate-pulse' : ''}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">
                      {call.state === 'waiting_permission' && 'Waiting for permission…'}
                      {call.state === 'connecting' && 'Starting call…'}
                      {call.state === 'ringing' && 'Ringing…'}
                      {call.state === 'connected' && (activeConvo?.contactName || `+${activePhone}`)}
                    </p>
                    {call.state === 'connected' && (
                      <p className="text-[11px] text-white/80 font-mono">
                        {Math.floor(call.elapsedSec / 60)}:{String(call.elapsedSec % 60).padStart(2, '0')}
                      </p>
                    )}
                  </div>
                  {call.inCall && (
                    <>
                      <button
                        onClick={call.toggleMute}
                        aria-label={call.muted ? 'Unmute' : 'Mute'}
                        className={`w-9 h-9 rounded-full flex items-center justify-center ${call.muted ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}
                      >
                        <Icon icon={call.muted ? 'solar:microphone-off-bold' : 'solar:microphone-bold'} className="text-lg" />
                      </button>
                      <button
                        onClick={() => call.hangUp()}
                        aria-label="Hang up"
                        className="w-9 h-9 rounded-full bg-[#e54e4e] hover:bg-[#d03f3f] flex items-center justify-center"
                      >
                        <Icon icon="solar:phone-bold" className="text-lg rotate-[135deg]" />
                      </button>
                    </>
                  )}
                </div>
              )}
              <audio ref={call.remoteAudioRef} autoPlay playsInline className="hidden" />

              {/* Messages area — WhatsApp doodle pattern, theme-aware base */}
              <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-1 overscroll-contain bg-[#efeae2] dark:bg-[#0a0a0a] bg-repeat bg-[length:323px] bg-[url(/whatsapp-business/wa-doodle-light.png)] dark:bg-[url(/whatsapp-business/wa-doodle-dark.png)] select-none [-webkit-user-select:none] [-webkit-touch-callout:none]">
                {!threadData ? (
                  <div className="flex items-center justify-center h-full">
                    <Icon icon="svg-spinners:ring-resize" className="text-3xl text-[#25D366]" />
                  </div>
                ) : !groups.length ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="bg-white dark:bg-[#202020] px-4 py-2 rounded-lg shadow-sm text-[13px] text-[#667781] dark:text-[#8c8c8c]">
                      {t('noMessagesYet')}
                    </div>
                  </div>
                ) : (
                  groups.map(group => (
                    <div key={group.label}>
                      <div className="flex justify-center my-3">
                        <span className="bg-white dark:bg-[#202020] text-[#54656f] dark:text-[#8c8c8c] text-[11.5px] font-medium px-3 py-1 rounded-full shadow-sm">
                          {group.label}
                        </span>
                      </div>

                      {(() => {
                        const allMsgs = group.messages
                        const msgIds = new Set(allMsgs.map(m => m.wa_message_id))

                        // Build the reaction overlay map: a reaction renders as a
                        // badge on its parent, not as its own bubble.
                        const reactionsMap = new Map<string, string[]>()
                        const overlaidReactionIds = new Set<string>()
                        for (const m of allMsgs) {
                          if (m.type !== 'reaction') continue
                          const emoji = m.metadata?.reaction || m.body
                          if (!emoji) continue

                          const explicitParentId = m.metadata?.reaction_to
                          if (explicitParentId && msgIds.has(explicitParentId)) {
                            const ex = reactionsMap.get(explicitParentId) ?? []
                            if (!ex.includes(emoji)) reactionsMap.set(explicitParentId, [...ex, emoji])
                            overlaidReactionIds.add(m.id)
                            continue
                          }

                          // Fallback: attach to the closest non-reaction message before it.
                          const reactionTime = new Date(m.timestamp).getTime()
                          let parent: WaMessage | null = null
                          for (const c of allMsgs) {
                            if (c.type === 'reaction') continue
                            const ct = new Date(c.timestamp).getTime()
                            if (ct <= reactionTime) {
                              if (!parent || ct > new Date(parent.timestamp).getTime()) parent = c
                            }
                          }
                          if (parent) {
                            const ex = reactionsMap.get(parent.wa_message_id) ?? []
                            if (!ex.includes(emoji)) reactionsMap.set(parent.wa_message_id, [...ex, emoji])
                            overlaidReactionIds.add(m.id)
                          }
                        }

                        return (
                          <div className="space-y-1">
                            {allMsgs.map(msg => {
                              if (overlaidReactionIds.has(msg.id)) return null

                              const isOut = bubbleIsOut(msg, activePhone, platformInbox)
                              const reactions = reactionsMap.get(msg.wa_message_id) ?? []
                              const failureMsg = isOut ? deliveryFailure(msg) : null
                              const carouselCards = carouselCardsOf(msg)
                              const choice = carouselChoiceOf(msg)
                              const quotedParent = msg.metadata?.reply_to
                                ? messagesByWamid.get(String(msg.metadata.reply_to))
                                : undefined

                              // Orphan reaction (no parent found) → its own small bubble
                              if (msg.type === 'reaction') {
                                const emoji = msg.metadata?.reaction || msg.body || '❤️'
                                return (
                                  <div key={msg.id} dir="ltr" className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                                    <div className="flex items-center gap-1 bg-white dark:bg-[#202020] border border-gray-100 dark:border-[#333333] rounded-full px-2.5 py-1 shadow-sm">
                                      <span className="text-[18px] leading-none">{emoji}</span>
                                      <span className="text-[10px] text-[#667781] dark:text-[#8c8c8c]">
                                        {fmtTimeFull(msg.timestamp, locale)}
                                      </span>
                                    </div>
                                  </div>
                                )
                              }

                              return (
                                <div key={msg.id} dir="ltr" className={`flex min-w-0 ${isOut ? 'justify-end' : 'justify-start'} px-2`}>
                                  <div
                                    className={`relative min-w-0 ${carouselCards ? 'w-full max-w-[min(100%,28rem)]' : msg.type === 'audio' ? '' : 'max-w-[82%] sm:max-w-[65%]'} ${reactions.length ? 'mb-4' : ''}`}
                                    {...bindMessagePress(msg)}
                                  >
                                    <div
                                      className={`rounded-lg shadow-sm text-[14px] leading-[1.4] overflow-hidden select-none ${
                                        isOut
                                          ? 'bg-[#d9fdd3] text-[#111111] dark:bg-[#144d37] dark:text-[#e9edef] rounded-br-none'
                                          : 'bg-white dark:bg-[#202020] text-[#111111] dark:text-[#e9edef] rounded-bl-none'
                                      }`}
                                    >
                                      {(quotedParent || choice) && (
                                        <ReplyQuote parent={quotedParent} choice={choice} isOut={isOut} />
                                      )}
                                      {carouselCards ? (
                                        <p className="px-3 pt-2 pb-0 whitespace-pre-wrap break-words">
                                          {renderWaText(carouselBodyOf(msg))}
                                        </p>
                                      ) : msg.type === 'image' && msg.media_url ? (
                                        <div>
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={srcFor(msg.media_url)}
                                            alt={t('photo')}
                                            className="max-w-full max-h-[280px] w-full object-cover cursor-pointer active:opacity-80 transition-opacity"
                                            loading="lazy"
                                            onClick={() => {
                                              if (suppressClickRef.current) {
                                                suppressClickRef.current = false
                                                return
                                              }
                                              setLightboxSrc(srcFor(msg.media_url!))
                                            }}
                                          />
                                          {msg.body && (
                                            <p className="px-3 pt-1.5 pb-0 whitespace-pre-wrap break-words">{renderWaText(msg.body)}</p>
                                          )}
                                        </div>
                                      ) : msg.type === 'video' && msg.media_url ? (
                                        <div>
                                          <div className="relative bg-black rounded-t-lg min-h-[160px] flex items-center justify-center">
                                            <video
                                              src={srcFor(msg.media_url)}
                                              controls
                                              preload="metadata"
                                              className="max-w-full max-h-[280px] w-full"
                                              playsInline
                                            />
                                          </div>
                                          {msg.body && msg.body !== '🎥 Video' && msg.body !== `🎥 ${t('video')}` && (
                                            <p className="px-3 pt-1.5 pb-0 whitespace-pre-wrap break-words">{renderWaText(msg.body)}</p>
                                          )}
                                        </div>
                                      ) : msg.type === 'audio' && msg.media_url ? (
                                        <AudioPlayer
                                          src={srcFor(msg.media_url)}
                                          isOut={isOut}
                                          storedDuration={msg.metadata?.voice_duration ?? undefined}
                                          timestamp={msg.timestamp}
                                          status={msg.status}
                                        />
                                      ) : msg.template_preview ? (
                                        <TemplateBubble preview={msg.template_preview} />
                                      ) : (
                                        <p className="px-3 pt-2 pb-0 whitespace-pre-wrap break-words">
                                          {msg.body ? renderWaText(msg.body) : (
                                            msg.type === 'image'    ? `📷 ${t('photo')}` :
                                            msg.type === 'video'    ? `🎥 ${t('video')}` :
                                            msg.type === 'audio'    ? `🎙️ ${t('voiceMessage')}` :
                                            msg.type === 'document' ? `📄 ${t('document')}` :
                                            msg.type === 'sticker'  ? `🎨 ${t('sticker')}` :
                                            msg.type === 'location' ? `📍 ${t('location')}` :
                                            `📎 ${t('attachment')}`
                                          )}
                                        </p>
                                      )}
                                      {/* Audio carries its own timestamp inside the player */}
                                      {msg.type !== 'audio' && (
                                        <div className={`px-3 pb-1.5 flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                          {starredIds.has(msg.id) && (
                                            <Icon icon="solar:star-bold" className="text-[11px] text-[#f59e0b]" />
                                          )}
                                          <span className={`text-[11px] ${isOut ? 'text-[#667781] dark:text-[#8fb7ad]' : 'text-[#667781] dark:text-[#8c8c8c]'}`}>
                                            {fmtTimeFull(msg.timestamp, locale)}
                                          </span>
                                          {isOut && <StatusTick status={msg.status} />}
                                        </div>
                                      )}
                                    </div>

                                    {carouselCards && (
                                      <CarouselStrip
                                        cards={carouselCards}
                                        onOpenImage={src => setLightboxSrc(src)}
                                      />
                                    )}

                                    {failureMsg && (
                                      <div className="flex items-center gap-1 mt-0.5 justify-end pr-0.5">
                                        <Icon icon="solar:danger-triangle-bold" className="text-[12px] text-red-500 flex-shrink-0" />
                                        <span className="text-[11px] font-medium text-red-500 dark:text-red-400">
                                          {failureMsg}
                                        </span>
                                      </div>
                                    )}

                                    {reactions.length > 0 && (
                                      <div className={`absolute -bottom-3.5 ${isOut ? 'left-1' : 'right-1'}`}>
                                        <div className="flex items-center gap-0.5 bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-[#333333] rounded-full px-1.5 py-0.5 shadow-sm">
                                          {reactions.map((emoji, i) => (
                                            <span key={i} className="text-[14px] leading-none">{emoji}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {replyTo && (
                <div className="px-3 pt-2 bg-[#f0f2f5] dark:bg-[#0a0a0a] border-t border-[#e9edef] dark:border-[#2a2a2a] flex items-stretch gap-2">
                  <div className="flex-1 min-w-0 border-l-4 border-[#25D366] bg-white dark:bg-[#202020] rounded-md px-2.5 py-1.5">
                    <p className="text-[12px] font-semibold text-[#25D366]">
                      {replyTo.direction === 'inbound' ? (activeConvo?.contactName || 'Reply') : 'You'}
                    </p>
                    <p className="text-[13px] truncate text-[#667781] dark:text-[#8c8c8c]">{messagePlainText(replyTo)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="w-8 flex items-center justify-center text-[#667781]"
                    aria-label="Cancel reply"
                  >
                    <Icon icon="solar:close-circle-bold" className="text-lg" />
                  </button>
                </div>
              )}

              {/* Message input — compact, matches WhatsApp desktop proportions */}
              <div
                className="relative px-3 py-2 flex items-end gap-1.5 bg-[#f0f2f5] dark:bg-[#0a0a0a] border-t border-[#e9edef] dark:border-[#2a2a2a]"
                style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
              >
                {showEmoji && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowEmoji(false)} />
                    <div className="absolute bottom-full left-2 right-2 mb-2 z-20 max-h-[240px] overflow-y-auto rounded-2xl bg-white dark:bg-[#1e1e1e] border border-[#e9edef] dark:border-[#2a2a2a] shadow-lg p-2">
                      {EMOJI_GROUPS.map(group => (
                        <div key={group.label}>
                          <p className="px-1.5 pt-1 pb-0.5 text-[11px] font-medium text-[#667781] dark:text-[#8c8c8c] sticky top-0 bg-white dark:bg-[#1e1e1e]">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-8 gap-0.5">
                            {group.emojis.map((e, i) => (
                              <button
                                key={`${group.label}-${i}`}
                                type="button"
                                onClick={() => insertEmoji(e)}
                                className="h-8 w-full rounded-lg text-[20px] leading-none flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {audioPreviewUrl ? (
                  /* ── Voice preview mode ── */
                  <>
                    <button
                      onClick={cancelVoice}
                      className="w-9 h-9 rounded-full bg-white dark:bg-[#2a2a2a] flex items-center justify-center shadow-sm text-red-500 flex-shrink-0"
                    >
                      <Icon icon="solar:trash-bin-trash-bold" className="text-[17px]" />
                    </button>
                    <div className="flex-1 bg-white dark:bg-[#2a2a2a] rounded-[20px] shadow-sm overflow-hidden self-center">
                      <AudioPlayer src={audioPreviewUrl} isOut storedDuration={recordingTime} compact />
                    </div>
                    <button
                      onClick={sendVoice}
                      disabled={sending}
                      className="w-9 h-9 rounded-full bg-[#25D366] hover:bg-[#1da851] disabled:opacity-50 flex items-center justify-center flex-shrink-0 transition-all shadow-sm"
                    >
                      <Icon icon={sending ? 'svg-spinners:ring-resize' : 'solar:plain-bold'} className="text-[16px] text-white dark:text-[#0a0a0a]" />
                    </button>
                  </>
                ) : isRecording ? (
                  /* ── Recording mode ── */
                  <>
                    <button
                      onClick={stopRecording}
                      className="w-9 h-9 rounded-full bg-white dark:bg-[#2a2a2a] flex items-center justify-center shadow-sm text-gray-500 flex-shrink-0"
                    >
                      <Icon icon="solar:close-circle-bold" className="text-[18px]" />
                    </button>
                    <div className="flex-1 flex items-center gap-3 bg-white dark:bg-[#2a2a2a] rounded-[20px] px-4 py-2 shadow-sm">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                      <span className="text-[15px] font-mono text-[#111111] dark:text-[#e9edef] tabular-nums">
                        {fmtDuration(recordingTime)}
                      </span>
                      <span className="text-[13px] text-[#667781] dark:text-[#8c8c8c]">{t('recording')}</span>
                    </div>
                    <button
                      onClick={stopRecording}
                      className="w-9 h-9 rounded-full bg-[#25D366] hover:bg-[#1da851] flex items-center justify-center flex-shrink-0 transition-all shadow-sm"
                    >
                      <Icon icon="solar:stop-bold" className="text-[16px] text-white dark:text-[#0a0a0a]" />
                    </button>
                  </>
                ) : (
                  /* ── Normal text input mode ── */
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp"
                      className="hidden"
                      onChange={handleMediaPick}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      aria-label={t('attach')}
                      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors text-[#54656f] dark:text-[#8c8c8c] hover:bg-black/5 dark:hover:bg-white/10"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <Icon icon="ic:round-add" className="text-[23px]" />
                    </button>
                    <div className="flex-1 flex items-center gap-2 bg-white dark:bg-[#2a2a2a] rounded-[20px] pl-3.5 pr-3 py-1.5 shadow-sm">
                      <textarea
                        ref={inputRef}
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        autoFocus
                        placeholder={t('typeMessage')}
                        rows={1}
                        style={{ maxHeight: '100px', overflowY: 'auto' }}
                        className="flex-1 bg-transparent text-[15px] text-[#111111] dark:text-[#e9edef] placeholder:text-[#667781] dark:placeholder:text-[#8c8c8c] outline-none resize-none leading-[20px]"
                        onInput={e => {
                          const el = e.currentTarget
                          el.style.height = 'auto'
                          el.style.height = `${Math.min(el.scrollHeight, 100)}px`
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowEmoji(v => !v)}
                        aria-label={t('emoji')}
                        className={`flex-shrink-0 transition-colors ${showEmoji ? 'text-[#25D366]' : 'text-[#54656f] dark:text-[#8c8c8c] hover:text-[#3b4a54] dark:hover:text-[#aeaeae]'}`}
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        <Icon icon="solar:smile-circle-linear" className="text-[20px]" />
                      </button>
                    </div>
                    {messageText.trim() ? (
                      <button
                        onClick={handleSend}
                        disabled={sending}
                        aria-label={t('send')}
                        className="w-9 h-9 rounded-full bg-[#25D366] hover:bg-[#1da851] disabled:opacity-50 flex items-center justify-center flex-shrink-0 transition-all shadow-sm"
                      >
                        <Icon icon={sending ? 'svg-spinners:ring-resize' : 'solar:plain-bold'} className="text-[16px] text-white dark:text-[#0a0a0a]" />
                      </button>
                    ) : (
                      <button
                        onClick={startRecording}
                        aria-label="Record voice message"
                        className="w-9 h-9 rounded-full bg-[#25D366] hover:bg-[#1da851] flex items-center justify-center flex-shrink-0 transition-all shadow-sm"
                      >
                        <Icon icon="mdi:microphone" className="text-[18px] text-white dark:text-[#0a0a0a]" />
                      </button>
                    )}
                  </>
                )}
              </div>

              {platformInbox ? (
                <OwnerDetailsPanel
                  open={showOrders}
                  onClose={() => setShowOrders(false)}
                  data={ownerInfo}
                  loading={ownerInfoLoading}
                  phone={activePhone}
                />
              ) : (
                <OrderDetailsPanel
                  open={showOrders}
                  onClose={() => setShowOrders(false)}
                  data={contactOrders}
                  loading={ordersLoading}
                  phone={activePhone}
                  fallbackName={activeConvo?.contactName ?? null}
                  sendingOrderId={sendingVariantsId}
                  onSendVariants={sendVariants}
                />
              )}
            </div>
          )}
        </div>

        {/* Media preview overlay (before sending) */}
        {mediaPreviewUrl && mediaFile && (
          <div className="fixed inset-0 z-[200] flex flex-col bg-[#111111]/95 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) captionRef.current?.focus() }}>
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={cancelMedia}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <Icon icon="solar:close-circle-bold" className="text-2xl text-white/80" />
              </button>
              <span className="text-white/70 text-sm font-medium">
                {mediaFile.type.startsWith('video/') ? t('video') : t('photo')}
              </span>
              <div className="w-10" />
            </div>

            <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
              {mediaFile.type.startsWith('video/') ? (
                <video
                  src={mediaPreviewUrl}
                  controls
                  className="max-w-full max-h-full rounded-lg object-contain"
                  style={{ maxHeight: 'calc(100vh - 180px)' }}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={mediaPreviewUrl}
                  alt="Preview"
                  className="max-w-full max-h-full rounded-lg object-contain"
                  style={{ maxHeight: 'calc(100vh - 180px)' }}
                />
              )}
            </div>

            <div className="px-4 pb-4 pt-2 flex items-end gap-3" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
              <div className="flex-1 flex items-end bg-[#2a2a2a] rounded-2xl px-4 py-2.5 shadow-sm">
                <textarea
                  ref={captionRef}
                  value={mediaCaption}
                  onChange={e => setMediaCaption(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      e.stopPropagation()
                      void sendMedia()
                    }
                  }}
                  placeholder={t('addCaption')}
                  rows={1}
                  autoFocus
                  className="flex-1 bg-transparent text-[15px] text-[#e9edef] placeholder:text-[#8c8c8c] outline-none resize-none leading-[20px]"
                />
              </div>
              <button
                onClick={sendMedia}
                disabled={mediaUploading}
                className="w-12 h-12 rounded-full bg-[#25D366] hover:bg-[#1da851] disabled:opacity-50 flex items-center justify-center flex-shrink-0 transition-all shadow-lg"
              >
                <Icon icon={mediaUploading ? 'svg-spinners:ring-resize' : 'solar:plain-bold'} className="text-xl text-white" />
              </button>
            </div>
          </div>
        )}

        {actionMsg && (
          <MessageActionSheet
            msg={actionMsg}
            starred={starredIds.has(actionMsg.id)}
            onReact={emoji => sendReaction(actionMsg, emoji)}
            onReply={() => {
              setReplyTo(actionMsg)
              setActionMsg(null)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
            onForward={() => {
              setForwardMsg(actionMsg)
              setActionMsg(null)
            }}
            onCopy={() => copyMessage(actionMsg)}
            onStar={() => toggleStar(actionMsg)}
            onDelete={() => hideMessage(actionMsg)}
            onClose={() => setActionMsg(null)}
          />
        )}

        {forwardMsg && (
          <ForwardPicker
            conversations={conversations}
            onPick={forwardTo}
            onClose={() => setForwardMsg(null)}
          />
        )}

        {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    </>
  )
}
