'use client'

import { useState } from 'react'
import { Icon } from '@iconify/react'
import {
  blockerLink,
  limitLabel,
  metaLink,
  openItemCount,
  type HealthLevel,
  type WhatsAppHealth,
} from '@/lib/health'

/**
 * What the seller sees the moment Embedded Signup returns — instead of a toast.
 *
 * Meta's last dialog says the business will be reviewed "within 24 hours" and
 * offers to add a payment method, then closes. A seller who skims it (or reads it
 * in a language they don't use) is left with "WhatsApp connected" and no idea that
 * the number isn't activated yet, or that they're on Meta's test number, or that a
 * payment error will stop every message they try to start. So the success state is
 * a checklist of Meta's own answers, not a green tick.
 *
 * Every row says the same three things: what it is, where it stands, and what to do
 * about it — with Meta's `possible_solution` text and a deep link to the exact
 * settings page when the fix is on their side.
 */

interface ConnectionHealthProps {
  health: WhatsAppHealth
  phone: { displayPhone?: string | null; verifiedName?: string | null } | null
  /** Re-reads status from Meta: the first seconds after signup are in flux. */
  onRecheck: () => Promise<void>
  onOpenInbox: () => void
  /** Back to the connect card, to link a different number. */
  onSwitchNumber: () => void
}

const TONE: Record<HealthLevel, { icon: string; className: string }> = {
  ready: { icon: 'solar:check-circle-bold', className: 'text-emerald-500' },
  pending: { icon: 'solar:clock-circle-bold', className: 'text-amber-500' },
  blocked: { icon: 'solar:close-circle-bold', className: 'text-red-500' },
  unknown: { icon: 'solar:question-circle-bold', className: 'text-gray-400' },
}

interface Row {
  key: string
  level: HealthLevel
  title: string
  body: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export default function ConnectionHealth({
  health,
  phone,
  onRecheck,
  onOpenInbox,
  onSwitchNumber,
}: ConnectionHealthProps) {
  const [rechecking, setRechecking] = useState(false)

  const open = openItemCount(health)
  const allGood = health.level === 'ready'

  const recheck = async () => {
    setRechecking(true)
    try {
      await onRecheck()
    } finally {
      setRechecking(false)
    }
  }

  const rows: Row[] = []

  // Ordered by what stops messages first, so the top row is the one to act on.
  if (health.testNumber) {
    rows.push({
      key: 'test-number',
      level: 'pending',
      title: 'This is Meta’s test number, not yours',
      body: 'Meta hands this +1 555 number out with a new account. If you bought a WhatsApp number, add that number in WhatsApp Manager — you can send without verifying the business first.',
      action: { label: 'Add the number I bought', href: metaLink('numbers', health.businessId) },
    })
  } else {
    rows.push({
      key: 'registration',
      level: health.registration,
      title:
        health.registration === 'ready'
          ? 'Number is active on Meta'
          : health.registration === 'blocked'
            ? 'Meta has restricted this number'
            : 'Meta is still activating the number',
      body:
        health.registration === 'ready'
          ? 'Meta has finished setting up the number. Messages can come in and go out.'
          : health.registration === 'blocked'
            ? 'Meta has flagged or restricted this number, so it can’t send. Open WhatsApp Manager to see what they’re asking for.'
            : 'Meta accepted the number but hasn’t switched it on yet — this usually takes a few minutes. Nothing to do; check again in a moment.',
      action:
        health.registration === 'blocked'
          ? { label: 'Open WhatsApp Manager', href: metaLink('manager', health.businessId) }
          : undefined,
    })
  }

  if (health.review === 'ready' || health.review === 'blocked') {
    rows.push({
      key: 'review',
      level: health.review,
      title:
        health.review === 'ready'
          ? 'Business approved by Meta'
          : 'Meta rejected the business review',
      body:
        health.review === 'ready'
          ? 'The review Meta mentioned when you connected is done — it passed. You do not need to verify the business to start sending.'
          : 'Meta turned down the review. They explain what to change in WhatsApp Manager; you can fix it and ask again.',
      action:
        health.review === 'blocked'
          ? { label: 'Open WhatsApp Manager', href: metaLink('manager', health.businessId) }
          : undefined,
    })
  }

  if (health.blockers.length > 0) {
    for (const blocker of health.blockers) {
      // 141010 = volume cap only. Not required to send; the note below covers it.
      if (blocker.code === 141010) continue
      const link = blockerLink(blocker, health.businessId)
      rows.push({
        key: `blocker-${blocker.code ?? blocker.message.slice(0, 12)}`,
        level: blocker.scope === 'all' ? 'blocked' : 'pending',
        title:
          blocker.code === 141006
            ? 'Payment method needs fixing'
            : 'Meta is limiting your messages',
        // Meta's own wording is more precise than a paraphrase, and its
        // `possible_solution` is the instruction the seller will be given anyway.
        body: [blocker.message, blocker.solution].filter(Boolean).join(' '),
        action: link,
      })
    }
  } else {
    rows.push({
      key: 'sending',
      level: health.sending,
      title: health.sending === 'ready' ? 'Meta allows sending' : 'Checking send permission',
      body:
        health.sending !== 'ready'
          ? 'Meta hasn’t reported a send status for this account yet.'
          : health.testNumber
            ? 'No restrictions on the account itself — but a test number still only reaches the contacts you add by hand.'
            : 'No restrictions on the account: you can reply to customers and send them updates.',
    })
  }

  if (health.linkedToPhoneApp) {
    rows.push({
      key: 'phone-app',
      level: 'ready',
      title: 'Your WhatsApp Business app still works',
      body: 'The number runs in both places: messages arrive on your phone and here, and either can answer.',
    })
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] dark:bg-[#0b141a] px-4 py-8 sm:py-12">
      <div className="max-w-xl mx-auto">
        {/* ── Outcome ─────────────────────────────────────────────────────── */}
        <div className="text-center mb-7">
          <div
            className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 ${
              allGood ? 'bg-[#25D366]/10' : 'bg-amber-500/10'
            }`}
          >
            <Icon
              icon={allGood ? 'solar:check-circle-bold' : 'solar:clipboard-list-bold-duotone'}
              className={`text-3xl ${allGood ? 'text-[#25D366]' : 'text-amber-500'}`}
            />
          </div>
          <h1 className="text-2xl sm:text-[28px] font-bold text-gray-900 dark:text-white tracking-tight">
            {allGood
              ? 'Your WhatsApp is live'
              : open === 1
                ? 'Connected — one thing left'
                : `Connected — ${open} things left`}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-[#8696a0] leading-relaxed">
            {allGood
              ? 'Everything Meta checks has passed. Customer messages land in your inbox.'
              : 'Your number is linked to FlashManager. Here’s exactly where Meta has got to, and what’s still open.'}
          </p>
        </div>

        {/* The number, so a seller notices immediately if it isn't the one they meant. */}
        {(phone?.displayPhone || phone?.verifiedName) && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-[#313d45] bg-white dark:bg-[#1f2c33] px-4 py-3">
            <div className="w-10 h-10 rounded-full bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
              <Icon icon="logos:whatsapp-icon" className="text-xl" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-gray-900 dark:text-white font-mono">
                {phone?.displayPhone || '—'}
              </p>
              {phone?.verifiedName && (
                <p className="text-[12px] text-gray-500 dark:text-[#8696a0] truncate">{phone.verifiedName}</p>
              )}
            </div>
          </div>
        )}

        {/* ── The one question a seller actually has ──────────────────────── */}
        {/* A test number is reachable by Meta's rules and useless by the seller's:
            only contacts they add by hand can write to it. Saying "customers can
            message you" there would be the same kind of true-but-wrong as the toast
            this screen replaced. */}
        {health.testNumber ? (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3.5">
            <Icon icon="solar:chat-round-line-bold" className="text-xl flex-shrink-0 mt-0.5 text-amber-500" />
            <div className="text-[13px] leading-relaxed">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Your customers can’t reach this number yet.
              </p>
              <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">
                It’s a demo number Meta hands out with a new account. Add the number you
                bought — or the one on your phone — in WhatsApp Manager. You can send
                without verifying the business.
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${
              health.canReply
                ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30'
            }`}
          >
            <Icon
              icon={health.canReply ? 'solar:chat-round-check-bold' : 'solar:chat-round-dots-bold'}
              className={`text-xl flex-shrink-0 mt-0.5 ${health.canReply ? 'text-emerald-500' : 'text-red-500'}`}
            />
            <div className="text-[13px] leading-relaxed">
              {health.canReply ? (
                <>
                  <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                    Customers can message you, and you can reply.
                  </p>
                  {health.sending !== 'ready' && (
                    <p className="mt-0.5 text-emerald-800/80 dark:text-emerald-200/70">
                      What’s blocked is messages <em className="not-italic font-medium">you</em> start first —
                      order updates and promotions — until the items below are cleared.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold text-red-900 dark:text-red-200">
                    Messages can’t go out yet.
                  </p>
                  <p className="mt-0.5 text-red-800/80 dark:text-red-200/70">
                    Clear the items below and this changes on its own — no need to reconnect.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Meta's answers, one row each ─────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 dark:border-[#313d45] bg-white dark:bg-[#1f2c33] divide-y divide-gray-100 dark:divide-[#2a3942] overflow-hidden">
          {rows.map(row => {
            const tone = TONE[row.level]
            return (
              <div key={row.key} className="flex items-start gap-3 px-4 py-3.5">
                <Icon icon={tone.icon} className={`text-lg flex-shrink-0 mt-0.5 ${tone.className}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{row.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-gray-500 dark:text-[#8696a0] leading-relaxed">
                    {row.body}
                  </p>
                  {row.action &&
                    (row.action.href ? (
                      <a
                        href={row.action.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#1877F2] hover:underline"
                      >
                        {row.action.label}
                        <Icon icon="solar:arrow-right-up-linear" className="text-[13px]" />
                      </a>
                    ) : (
                      <button
                        onClick={row.action.onClick}
                        className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#25D366] hover:underline"
                      >
                        {row.action.label}
                        <Icon icon="solar:arrow-right-linear" className="text-[13px]" />
                      </button>
                    ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── The two costs nobody mentions until they bite ────────────────── */}
        <div className="mt-4 rounded-2xl bg-[#f0f5ed] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 px-4 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-2">
            Good to know
          </p>
          <ul className="space-y-2 text-[12.5px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
            <li className="flex items-start gap-2">
              <Icon icon="solar:chart-2-bold-duotone" className="text-sm flex-shrink-0 mt-0.5" />
              <span>
                Meta caps you at <span className="font-semibold">{limitLabel(health)}</span> that you start.
                {health.businessVerified
                  ? ' The cap rises on its own as customers reply to you.'
                  : ' Verifying your business with Meta raises it.'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Icon icon="solar:card-bold-duotone" className="text-sm flex-shrink-0 mt-0.5" />
              <span>
                Replying to a customer within 24 hours of their message is free. Messages you start
                (order updates, promotions) are billed by Meta, which is why it asks for a payment method.
              </span>
            </li>
          </ul>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
          <button
            onClick={onOpenInbox}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold text-white bg-[#25D366] hover:brightness-110 transition-all"
          >
            <Icon icon="solar:chat-round-dots-bold" className="text-base" />
            Open my inbox
          </button>
          {!allGood && (
            <button
              onClick={recheck}
              disabled={rechecking}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[14px] font-semibold text-gray-700 dark:text-[#d1d7db] bg-white dark:bg-[#1f2c33] border border-gray-200 dark:border-[#313d45] hover:bg-gray-50 dark:hover:bg-[#2a3942] disabled:opacity-60 transition-colors"
            >
              <Icon
                icon={rechecking ? 'svg-spinners:ring-resize' : 'solar:refresh-bold'}
                className="text-base"
              />
              {rechecking ? 'Checking…' : 'Check again'}
            </button>
          )}
        </div>

        <button
          onClick={onSwitchNumber}
          className="mt-4 w-full text-center text-[12px] text-gray-400 dark:text-[#67737a] hover:text-gray-600 dark:hover:text-[#8696a0] transition-colors"
        >
          Use a different number
        </button>
      </div>
    </div>
  )
}
