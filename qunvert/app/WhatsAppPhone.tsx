'use client'

/**
 * WhatsApp chat mockup inside an iPhone frame — port of WHATSAPP-design.md.
 * Hard-coded WhatsApp palette on purpose: the preview must look like WhatsApp regardless
 * of the surrounding app theme. Only the outer bezel is dark-mode aware.
 */

import { useState, type ReactElement, type ReactNode, type RefObject } from 'react'

const svg = (className: string | undefined, viewBox: string, children: ReactNode, extra: Record<string, string> = {}) => (
  <svg viewBox={viewBox} className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...extra}>
    {children}
  </svg>
)

export const WA_ICONS: Record<string, (className?: string) => ReactElement> = {
  back: (c) => svg(c, '0 0 24 24', <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />),
  user: (c) => svg(c, '0 0 24 24', <>
    <circle cx="12" cy="8.5" r="4.5" fill="currentColor" />
    <path d="M3.5 21c.6-4.4 4.2-7 8.5-7s7.9 2.6 8.5 7" fill="currentColor" />
  </>),
  video: (c) => svg(c, '0 0 24 24', <>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M15.5 10.5l5-3v9l-5-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </>),
  phone: (c) => svg(c, '0 0 24 24', <path d="M6.6 3.5c.6-.5 1.4-.4 1.9.2l2 2.6c.5.6.4 1.4-.1 1.9L9 9.5c.8 2.3 2.7 4.3 5.1 5.3l1.3-1.4c.5-.5 1.3-.6 1.9-.1l2.6 2c.6.5.7 1.3.2 1.9l-1.4 1.6c-.8.9-2.1 1.2-3.3.8C10.3 18 6 13.7 4.4 8.6c-.4-1.2-.1-2.5.8-3.3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />),
  checks: (c) => svg(c, '0 0 24 24', <>
    <path d="M2.5 12.5l4 4L15 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.5 16.5l2 2L21.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  emoji: (c) => svg(c, '0 0 24 24', <>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 14c1 1.6 2.3 2.4 4 2.4s3-.8 4-2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="9" cy="9.5" r="1.2" fill="currentColor" />
    <circle cx="15" cy="9.5" r="1.2" fill="currentColor" />
  </>),
  mic: (c) => svg(c, '0 0 24 24', <>
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
    <path d="M6 11.5a6 6 0 0012 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </>),
  send: (c) => svg(c, '0 0 24 24', <path d="M3 11.5L21 3l-4.2 18-5.3-6.6L3 11.5z" fill="currentColor" />),
  link: (c) => svg(c, '0 0 24 24', <>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </>),
}

const StatusIcons = () => (
  <>
    <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden="true">
      <rect x="0" y="7" width="3" height="4" rx="0.8" />
      <rect x="4.3" y="5" width="3" height="6" rx="0.8" />
      <rect x="8.6" y="2.5" width="3" height="8.5" rx="0.8" />
      <rect x="13" y="0" width="3" height="11" rx="0.8" />
    </svg>
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 4.2a9.5 9.5 0 0113 0" />
      <path d="M4 7a6 6 0 018 0" />
      <path d="M6.4 9.6a2.6 2.6 0 013.2 0" />
      <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
    <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="21.5" height="10.5" rx="3" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
      <rect x="2.5" y="2.5" width="18" height="7" rx="1.8" fill="currentColor" />
      <path d="M24 4.2v3.6a1.8 1.8 0 000-3.6z" fill="currentColor" opacity=".6" />
    </svg>
  </>
)

const DOODLE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cg fill='%23000' fill-opacity='.04'%3E%3Ccircle cx='20' cy='30' r='3'/%3E%3Ccircle cx='70' cy='15' r='2'/%3E%3Ccircle cx='130' cy='40' r='2.5'/%3E%3Ccircle cx='180' cy='20' r='2'/%3E%3Ccircle cx='40' cy='90' r='2'/%3E%3Ccircle cx='110' cy='105' r='3'/%3E%3Ccircle cx='165' cy='95' r='2'/%3E%3Ccircle cx='25' cy='160' r='2.5'/%3E%3Ccircle cx='90' cy='175' r='2'/%3E%3Ccircle cx='150' cy='160' r='3'/%3E%3C/g%3E%3C/svg%3E\")"

export function renderWhatsAppMessage(text: string): { __html: string } {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const bold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  return { __html: bold.replace(/\n/g, '<br/>') }
}

export function PhoneFrame({
  contactName,
  online = 'online',
  statusBarTime = '9:41',
  avatar,
  headerRight,
  bodyRef,
  footer,
  children,
}: {
  contactName: string
  online?: string
  statusBarTime?: string
  avatar?: string
  headerRight?: ReactNode
  bodyRef?: RefObject<HTMLDivElement>
  footer?: ReactNode
  children: ReactNode
}) {
  const [avatarBroken, setAvatarBroken] = useState(false)
  const showAvatar = Boolean(avatar) && !avatarBroken

  return (
    <div className="mx-auto w-[300px] overflow-hidden rounded-[38px] border-[3px] border-[#1a1a1a] bg-[#1a1a1a] shadow-2xl dark:border-[#555]">
      {/* Status bar */}
      <div className="flex items-center bg-[#075E54] px-5 pb-1 pt-2.5 text-white">
        <span className="flex-1 text-[11px] font-semibold text-white/90">{statusBarTime}</span>
        <span className="h-[22px] w-[72px] rounded-full bg-black" />
        <span className="flex flex-1 items-center justify-end gap-[5px]">
          <StatusIcons />
        </span>
      </div>

      {/* Chat header */}
      <div className="flex items-center gap-2.5 bg-[#075E54] px-3 py-2.5 text-white">
        {WA_ICONS.back('h-[14px] w-[14px]')}
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#DFE5E7] text-[#aab8c2]">
          {showAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" onError={() => setAvatarBroken(true)} />
          ) : (
            WA_ICONS.user('h-6 w-6')
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold">{contactName}</p>
          <p className="text-[10px] text-white/70">{online}</p>
        </div>
        {headerRight ?? (
          <span className="flex items-center gap-3.5 pr-1">
            {WA_ICONS.video('h-[18px] w-[18px]')}
            {WA_ICONS.phone('h-[17px] w-[17px]')}
          </span>
        )}
      </div>

      {/* Chat body */}
      <div
        ref={bodyRef}
        className="h-[432px] overflow-y-auto bg-[#ECE5DD]"
        style={{ backgroundImage: DOODLE, backgroundSize: '200px 200px' }}
      >
        <div className="flex min-h-full flex-col justify-end p-3">{children}</div>
      </div>

      {/* Footer */}
      {footer ?? (
        <div className="flex items-center gap-2 bg-[#F0F0F0] px-2.5 py-2">
          {WA_ICONS.emoji('h-4 w-4 text-[#54656F]')}
          <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-[10px] text-gray-400">Type a message</div>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#00A884] text-white">{WA_ICONS.mic('h-3 w-3')}</span>
        </div>
      )}

      {/* Home indicator */}
      <div className="flex justify-center bg-[#F0F0F0] py-2.5">
        <span className="h-[5px] w-[108px] rounded-full bg-[#1a1a1a]" />
      </div>
    </div>
  )
}

export function DayChip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const cls = 'mx-auto mb-2 rounded-md bg-white/90 px-3 py-0.5 text-[10px] font-medium text-gray-500 shadow-sm'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-white`}>{children}</button>
  ) : (
    <span className={cls}>{children}</span>
  )
}

export function Bubble({
  direction,
  time,
  error,
  html,
  children,
}: {
  direction: 'in' | 'out'
  time: string
  error?: boolean
  html?: { __html: string }
  children?: ReactNode
}) {
  const out = direction === 'out'
  return (
    <div className={`mb-1.5 flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-[1.5] text-gray-800 shadow-sm ${
          out ? 'rounded-tr-sm bg-[#DCF8C6]' : 'rounded-tl-sm bg-white'
        } ${error ? 'ring-1 ring-red-300' : ''}`}
      >
        {html ? (
          <span dir="auto" className="block whitespace-pre-wrap [unicode-bidi:plaintext]" dangerouslySetInnerHTML={html} />
        ) : (
          <span dir="auto" className="block whitespace-pre-wrap [unicode-bidi:plaintext]">{children}</span>
        )}
        <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[8px] text-[#667781]">
          {time}
          {out && WA_ICONS.checks('h-3 w-3 text-[#53bdeb]')}
        </span>
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="mb-1.5 flex justify-start">
      <div className="flex items-center gap-1 rounded-lg rounded-tl-sm bg-white px-3 py-2.5 shadow-sm">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/30" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </div>
    </div>
  )
}

export function WhatsAppPhonePreview({
  contactName,
  online,
  statusBarTime,
  messageTime = '9:41 AM',
  todayLabel = 'Today',
  message,
  avatar,
  ctaLabel,
}: {
  contactName: string
  online?: string
  statusBarTime?: string
  messageTime?: string
  todayLabel?: string
  message: string
  avatar?: string
  ctaLabel?: string
}) {
  return (
    <PhoneFrame contactName={contactName} online={online} statusBarTime={statusBarTime} avatar={avatar}>
      <DayChip>{todayLabel}</DayChip>
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-lg rounded-tr-sm bg-[#DCF8C6] px-3 py-2 text-[11px] leading-[1.6] text-gray-800 shadow-sm">
          <span dir="auto" className="block whitespace-pre-wrap [unicode-bidi:plaintext]" dangerouslySetInnerHTML={renderWhatsAppMessage(message)} />
          <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[8px] text-[#667781]">
            {messageTime}
            {WA_ICONS.checks('h-3 w-3 text-[#53bdeb]')}
          </span>
        </div>
      </div>
      {ctaLabel && (
        <div className="ml-auto mt-1 w-[90%] overflow-hidden rounded-xl border border-[#dfdfdf] bg-white shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <span className="flex w-full items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-[#00A884]">
            {WA_ICONS.link('h-3 w-3')}
            {ctaLabel}
          </span>
        </div>
      )}
    </PhoneFrame>
  )
}
