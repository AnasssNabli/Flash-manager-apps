/**
 * The connection verdict, as the platform computes it from Meta's Graph API
 * (`lib/whatsapp/health.ts` on the platform side — keep the two in step).
 *
 * The app only reads it: every judgement about what Meta will and won't allow is
 * made once, server-side, next to the token that can ask.
 */

export type HealthLevel = 'ready' | 'pending' | 'blocked' | 'unknown'

export interface WhatsAppBlocker {
  code: number | null
  entity: string
  message: string
  solution: string | null
  /** `business_initiated` = replies still work; `all` = nothing goes out. */
  scope: 'business_initiated' | 'all'
}

export interface WhatsAppHealth {
  level: HealthLevel
  registration: HealthLevel
  review: HealthLevel
  businessVerified: boolean
  linkedToPhoneApp: boolean
  testNumber: boolean
  sending: HealthLevel
  canReply: boolean
  blockers: WhatsAppBlocker[]
  messagingLimitTier: string | null
  businessId: string | null
  /** Inbox Call button is shown only when this is true. */
  canPlaceCalls?: boolean
}

const BUSINESS_SETTINGS = 'https://business.facebook.com'

/**
 * Meta's settings live behind portfolio-scoped URLs; without `business_id` a seller
 * with several portfolios lands on the wrong one. When we don't know the id, send
 * them to WhatsApp Manager and let Meta pick.
 */
export function metaLink(kind: 'payment' | 'verification' | 'numbers' | 'manager', businessId: string | null): string {
  const qs = businessId ? `?business_id=${businessId}` : ''
  switch (kind) {
    case 'payment':
      return `${BUSINESS_SETTINGS}/billing_hub/payment_settings${qs}`
    case 'verification':
      return `${BUSINESS_SETTINGS}/settings/security${qs}`
    case 'numbers':
      return `${BUSINESS_SETTINGS}/wa/manage/phone-numbers/${qs}`
    default:
      return `${BUSINESS_SETTINGS}/wa/manage/home/${qs}`
  }
}

/** Which Meta settings page fixes a given blocker. */
export function blockerLink(blocker: WhatsAppBlocker, businessId: string | null): { label: string; href: string } {
  if (blocker.code === 141006) return { label: 'Fix payment method', href: metaLink('payment', businessId) }
  if (blocker.code === 141010) return { label: 'Verify my business', href: metaLink('verification', businessId) }
  return { label: 'Open WhatsApp Manager', href: metaLink('manager', businessId) }
}

/** Codes that only cap volume — not required to start sending. */
function isAdvisoryBlocker(code: number | null): boolean {
  return code === 141010
}

function hasHardSendBlock(health: WhatsAppHealth): boolean {
  if (health.sending === 'blocked') return true
  if (health.sending !== 'pending') return false
  return health.blockers.some(b => !isAdvisoryBlocker(b.code))
}

/**
 * Items the seller must act on (or wait for) before the number is useful.
 * Business verification and a pending 24h review are not on this list —
 * they do not stop replies or the first messages the seller starts.
 */
export function openItemCount(health: WhatsAppHealth): number {
  let count = 0
  if (health.testNumber) count++
  else if (health.registration !== 'ready') count++
  if (health.review === 'blocked') count++
  if (hasHardSendBlock(health)) count++
  return count
}

/** Inbox strip / post-connect screen — only when something actually blocks. */
export function hasActionableHealth(health: WhatsAppHealth): boolean {
  return openItemCount(health) > 0
}

/** The daily conversation cap, in the words Meta uses for it. */
export function limitLabel(health: WhatsAppHealth): string {
  if (health.messagingLimitTier === 'TIER_250') return '250 new conversations a day'
  const match = /^TIER_(\d+)(K)?$/.exec(health.messagingLimitTier || '')
  if (match) {
    const n = parseInt(match[1], 10) * (match[2] ? 1000 : 1)
    return `${n.toLocaleString('en-US')} new conversations a day`
  }
  return '250 new conversations a day'
}
