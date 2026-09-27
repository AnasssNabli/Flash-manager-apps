'use client'

import { Icon } from '@iconify/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBridge } from '@/lib/useBridge'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type Channel = 'whatsapp' | 'instagram' | 'facebook'

type Conversation = {
  id: string
  channel: Channel
  accountId: string
  recipientId: string
  name: string
  lastMessage: string
  lastTimestamp: string
  unread: number
}

type ChatMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  type: string
  timestamp: string
  status: string | null
}

type Account = { id: string; displayName: string }

const CHANNELS: Array<{ id: Channel; label: string; icon: string; color: string }> = [
  { id: 'whatsapp', label: 'WhatsApp', icon: 'mdi:whatsapp', color: '#25D366' },
  { id: 'instagram', label: 'Instagram', icon: 'mdi:instagram', color: '#E1306C' },
  { id: 'facebook', label: 'Facebook', icon: 'mdi:facebook', color: '#1877F2' },
]

function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9\u0600-\u06FF ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

function formatTime(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function Avatar({ name, channel, size = 44 }: { name: string; channel: Channel; size?: number }) {
  const letter = initials(name)
  if (channel === 'instagram') {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px]" style={{ width: size, height: size }}>
        <span className="grid h-full w-full place-items-center rounded-full bg-white text-[13px] font-semibold text-[#262626]">{letter}</span>
      </span>
    )
  }
  const color = channel === 'facebook' ? '#0084ff' : '#25D366'
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white" style={{ width: size, height: size, background: color }}>
      {letter}
    </span>
  )
}

const STICKERS = ['😀', '😂', '😍', '🔥', '👍', '🙏', '😎', '💯', '🎉', '👋', '😭', '✨']

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function audioToWav(blob: Blob): Promise<Blob> {
  const audio = new AudioContext()
  try {
    const decoded = await audio.decodeAudioData(await blob.arrayBuffer())
    const channel = decoded.getChannelData(0)
    const buffer = new ArrayBuffer(44 + channel.length * 2)
    const view = new DataView(buffer)
    const write = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
    }
    write(0, 'RIFF')
    view.setUint32(4, 36 + channel.length * 2, true)
    write(8, 'WAVE')
    write(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, decoded.sampleRate, true)
    view.setUint32(28, decoded.sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, channel.length * 2, true)
    let offset = 44
    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
    return new Blob([buffer], { type: 'audio/wav' })
  } finally {
    await audio.close()
  }
}

async function stickerFile(emoji: string): Promise<{ data: string; mime: string; filename: string }> {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the sticker.')
  context.font = '280px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(emoji, 256, 280)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((file) => file ? resolve(file) : reject(new Error('Could not create the sticker.')), 'image/png')
  })
  return { data: await blobToBase64(blob), mime: 'image/png', filename: 'sticker.png' }
}

function preview(message: ChatMessage) {
  if (message.body) return message.body
  if (message.type === 'image') return 'Photo'
  if (message.type === 'video') return 'Video'
  if (message.type === 'audio') return 'Voice message'
  if (message.type === 'document') return 'Document'
  return message.type || ''
}

export default function Messagerie({ onClose }: { onClose: () => void }) {
  const { getFreshToken } = useBridge()
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [panel, setPanel] = useState<'emoji' | 'sticker' | null>(null)
  const [error, setError] = useState('')
  const threadEnd = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const recordChunks = useRef<Blob[]>([])

  const api = useCallback(async (path: string, body: Record<string, unknown>) => {
    const token = await getFreshToken()
    if (!token) throw new Error('Could not open your account.')
    const response = await fetch(`${BP}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(String(data.error || 'Something went wrong.'))
    return data
  }, [getFreshToken])

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true)
    try {
      const data = await api('/api/inbox/conversations', {
        channel,
        accountId: accountId || undefined,
        search,
      })
      const nextAccounts = Array.isArray(data.accounts) ? data.accounts as Account[] : []
      setAccounts(nextAccounts)
      if (!accountId && nextAccounts[0]?.id) setAccountId(nextAccounts[0].id)
      setConversations(Array.isArray(data.conversations) ? data.conversations : [])
      setError('')
    } catch (reason) {
      if (!silent) setError((reason as Error).message)
    } finally {
      if (!silent) setLoadingList(false)
    }
  }, [accountId, api, channel, search])

  const loadThread = useCallback(async (chat: Conversation, silent = false) => {
    if (!silent) setLoadingThread(true)
    try {
      const data = await api('/api/inbox/thread', {
        channel: chat.channel,
        chatId: chat.id,
        accountId: chat.accountId,
      })
      setMessages(Array.isArray(data.messages) ? data.messages : [])
    } catch (reason) {
      if (!silent) setError((reason as Error).message)
    } finally {
      if (!silent) setLoadingThread(false)
    }
  }, [api])

  useEffect(() => {
    setActiveId('')
    setMessages([])
    void loadConversations()
  }, [channel, accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversations(true) }, 250)
    return () => window.clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setInterval(() => { void loadConversations(true) }, 8000)
    return () => window.clearInterval(timer)
  }, [loadConversations])

  const active = useMemo(
    () => conversations.find((item) => item.id === activeId) || null,
    [activeId, conversations],
  )

  useEffect(() => {
    if (!active) return
    void loadThread(active)
    const timer = window.setInterval(() => { void loadThread(active, true) }, 5000)
    return () => window.clearInterval(timer)
  }, [active, loadThread])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages, activeId])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== 'ai-agents:oauth') return
      if (event.data?.ok) void loadConversations()
      else setError('The account was not connected. Please try again.')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [loadConversations])

  const connect = async () => {
    if (channel === 'whatsapp') return
    setConnecting(true)
    setError('')
    try {
      const data = await api('/api/meta/oauth/start', { provider: channel })
      const popup = window.open(String(data.url), 'ai-agents-meta-connect', 'popup=yes,width=620,height=760')
      if (!popup) setError('Please allow popups, then try again.')
    } catch {
      setError(`Could not connect ${channel === 'instagram' ? 'Instagram' : 'Facebook'} right now.`)
    } finally {
      setConnecting(false)
    }
  }

  const deliver = async (label: string, body: Record<string, unknown>, restore?: () => void) => {
    if (!active || sending) return
    setSending(true)
    setError('')
    setPanel(null)
    setMessages((current) => [...current, {
      id: `local-${Date.now()}`,
      direction: 'outbound',
      body: label,
      type: String(body.text ? 'text' : (body.media as { kind?: string } | undefined)?.kind || 'text'),
      timestamp: new Date().toISOString(),
      status: 'sent',
    }])
    try {
      await api('/api/inbox/send', {
        channel: active.channel,
        chatId: active.id,
        recipientId: active.recipientId,
        accountId: active.accountId,
        ...body,
      })
      await loadThread(active, true)
      await loadConversations(true)
    } catch (reason) {
      setError((reason as Error).message || 'Could not send this message.')
      restore?.()
    } finally {
      setSending(false)
    }
  }

  const send = async () => {
    if (!active || !draft.trim() || sending) return
    const text = draft.trim()
    setDraft('')
    await deliver(text, { text }, () => setDraft(text))
  }

  const sendFile = async (media: { kind: 'image' | 'audio' | 'video'; filename: string; mime: string; data: string }, label: string) => {
    await deliver(label, { text: '', media })
  }

  const onAttach = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('That file is too large. Keep it under 8 MB.')
      return
    }
    const mime = file.type.split(';')[0]
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : null
    if (!kind || (kind === 'video' && mime !== 'video/mp4') || (kind === 'image' && !['image/jpeg', 'image/png', 'image/webp'].includes(mime))) {
      setError('Attach a JPG, PNG, or MP4.')
      return
    }
    await sendFile({
      kind,
      filename: file.name || (kind === 'video' ? 'video.mp4' : 'photo.jpg'),
      mime,
      data: await blobToBase64(file),
    }, kind === 'video' ? 'Video' : 'Photo')
  }

  const toggleRecording = async () => {
    if (recording && recorder.current) {
      recorder.current.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const media = new MediaRecorder(stream)
      recordChunks.current = []
      media.ondataavailable = (event) => {
        if (event.data.size) recordChunks.current.push(event.data)
      }
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(false)
        const raw = new Blob(recordChunks.current, { type: media.mimeType || 'audio/webm' })
        void audioToWav(raw)
          .then((wav) => blobToBase64(wav))
          .then((data) => sendFile({ kind: 'audio', filename: 'voice.wav', mime: 'audio/wav', data }, 'Voice message'))
          .catch(() => setError('Could not record that voice message.'))
      }
      recorder.current = media
      media.start()
      setRecording(true)
      setPanel(null)
    } catch {
      setError('Allow the microphone to record a voice message.')
    }
  }

  const accent = CHANNELS.find((item) => item.id === channel)
  const instagram = channel === 'instagram'
  const messenger = channel === 'facebook'
  const threadBg = instagram || messenger ? 'bg-white dark:bg-[#0d0d0d]' : 'bg-[#efeae2] dark:bg-[#0b141a]'
  const headerBg = instagram || messenger ? 'bg-white dark:bg-[#111]' : 'bg-[#f0f2f5] dark:bg-[#202020]'
  const composerBg = instagram || messenger ? 'bg-white dark:bg-[#111]' : 'bg-[#f0f2f5] dark:bg-[#202020]'
  const rowSelected = messenger ? 'bg-[#e7f3ff] dark:bg-[#0084ff]/15' : instagram ? 'bg-[#fafafa] dark:bg-white/10' : 'bg-[#f0f2f5] dark:bg-white/10'
  const unreadClass = messenger ? 'bg-[#0084ff]' : instagram ? 'bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]' : 'bg-[#25D366]'

  const bubbleClass = (outbound: boolean) => {
    if (instagram) {
      return outbound
        ? 'rounded-[22px] bg-[#3797f0] text-white'
        : 'rounded-[22px] bg-[#efefef] text-[#262626] dark:bg-white/10 dark:text-white'
    }
    if (messenger) {
      return outbound
        ? 'rounded-[18px] bg-[#0084ff] text-white'
        : 'rounded-[18px] bg-[#f0f0f0] text-[#050505] dark:bg-white/10 dark:text-white'
    }
    return outbound
      ? 'rounded-lg rounded-br-none bg-[#d9fdd3] text-[#111] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]'
      : 'rounded-lg rounded-bl-none bg-white text-[#111] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]'
  }

  const timeClass = (outbound: boolean) => {
    if ((instagram || messenger) && outbound) return 'text-white/75'
    return 'text-[#667781]'
  }

  const renderMessages = (wide: boolean) => (
    <div className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4 ${threadBg}`}>
      {loadingThread && !messages.length ? (
        <div className="grid h-full place-items-center text-sm text-slate-500">Loading messages…</div>
      ) : messages.map((message) => {
        const outbound = message.direction === 'outbound'
        return (
          <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
            <div className={`${wide ? 'max-w-[72%]' : 'max-w-[80%]'} px-3.5 py-2 text-[14px] leading-5 ${bubbleClass(outbound)}`}>
              <p className="whitespace-pre-wrap break-words">{preview(message)}</p>
              <p className={`mt-0.5 text-end text-[10px] ${timeClass(outbound)}`}>{formatTime(message.timestamp)}</p>
            </div>
          </div>
        )
      })}
      <div ref={threadEnd} />
    </div>
  )

  const iconButton = 'grid h-10 w-10 place-items-center rounded-full text-[#262626] hover:bg-black/5 disabled:opacity-40 dark:text-white dark:hover:bg-white/10'

  const renderComposer = () => instagram ? (
    <div className={`border-t border-black/5 px-3 py-2 dark:border-white/10 ${composerBg}`}>
      {panel && (
        <div className="mb-2 grid grid-cols-6 gap-1 rounded-2xl bg-[#fafafa] p-2 dark:bg-white/5">
          {(panel === 'emoji' ? STICKERS : STICKERS).map((emoji) => (
            <button
              key={`${panel}-${emoji}`}
              type="button"
              className="grid h-10 place-items-center rounded-xl text-xl hover:bg-white dark:hover:bg-white/10"
              onClick={() => {
                if (panel === 'emoji') {
                  setDraft((current) => `${current}${emoji}`)
                  return
                }
                void stickerFile(emoji).then((file) => sendFile({ kind: 'image', ...file }, 'Sticker')).catch(() => setError('Could not send that sticker.'))
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {recording && <p className="mb-1.5 text-xs font-medium text-rose-500">Recording… tap the microphone to send</p>}
      <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-[#efefef] px-1.5 dark:bg-[#262626]">
          <button type="button" className={iconButton} aria-label="Emoji" onClick={() => setPanel((current) => current === 'emoji' ? null : 'emoji')}>
            <Icon icon="solar:sticker-smile-circle-linear" width="22" />
          </button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message..."
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8e8e8e]"
          />
        </div>
        {draft.trim() ? (
          <button type="submit" disabled={sending} className="px-2 text-[15px] font-semibold text-[#3797f0] disabled:opacity-40">
            {sending ? 'Sending…' : 'Send'}
          </button>
        ) : (
          <>
            <button type="button" className={`${iconButton} ${recording ? 'text-rose-500' : ''}`} aria-label="Record audio" disabled={sending} onClick={() => void toggleRecording()}>
              <Icon icon="solar:microphone-3-linear" width="22" />
            </button>
            <button type="button" className={iconButton} aria-label="Attach media" disabled={sending} onClick={() => fileInput.current?.click()}>
              <Icon icon="solar:gallery-minimalistic-linear" width="22" />
            </button>
            <button type="button" className={iconButton} aria-label="Stickers" disabled={sending} onClick={() => setPanel((current) => current === 'sticker' ? null : 'sticker')}>
              <Icon icon="solar:sticker-smile-square-linear" width="22" />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void onAttach(file)
              }}
            />
          </>
        )}
      </form>
    </div>
  ) : (
    <form
      className={`flex items-center gap-2 border-t border-black/5 px-3 py-2 dark:border-white/10 ${composerBg}`}
      onSubmit={(event) => { event.preventDefault(); void send() }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={messenger ? 'Aa' : 'Type a message'}
        className={`h-10 flex-1 px-4 text-sm outline-none dark:text-white ${
          messenger ? 'rounded-full bg-[#efefef] dark:bg-white/10' : 'rounded-lg bg-white dark:bg-[#2a3942]'
        }`}
      />
      <button
        type="submit"
        disabled={!draft.trim() || sending}
        className={`grid h-10 w-10 place-items-center rounded-full text-white disabled:opacity-40 ${messenger ? 'bg-[#0084ff]' : 'bg-[#00a884]'}`}
        aria-label="Send"
      >
        <Icon icon={sending ? 'solar:refresh-circle-linear' : 'solar:plain-bold'} width="18" className={sending ? 'animate-spin' : ''} />
      </button>
    </form>
  )

  return (
    <div className={`flex h-screen min-h-0 text-[#111] dark:text-white ${instagram || messenger ? 'bg-white dark:bg-black' : 'bg-[#f0f2f5] dark:bg-black'}`}>
      <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-e border-[#e9edef] bg-white dark:border-white/10 dark:bg-[#111]">
        <header className="flex items-center gap-2 border-b border-[#e9edef] px-3 py-3 dark:border-white/10">
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/10" aria-label="Back">
            <Icon icon="solar:arrow-left-linear" width="20" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Messagerie</p>
            <p className="truncate text-[11px] text-slate-500 dark:text-white/40">Review AI replies and answer customers</p>
          </div>
        </header>

        <div className="px-3 py-2">
          <div className={`flex items-center gap-2 px-3 py-2 dark:bg-[#202020] ${instagram || messenger ? 'rounded-full bg-[#efefef]' : 'rounded-lg bg-[#f0f2f5]'}`}>
            <Icon icon="solar:magnifer-linear" className="text-[#54656f]" width="16" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search or start new chat"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#667781]"
            />
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto px-3 pb-2">
          {CHANNELS.map((item) => {
            const selected = channel === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setChannel(item.id); setAccountId('') }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] ${
                  selected ? 'font-semibold' : 'text-[#54656f] hover:bg-[#f0f2f5] dark:text-white/50 dark:hover:bg-white/5'
                }`}
                style={selected ? { background: `${item.color}22`, color: item.color } : undefined}
              >
                <Icon icon={item.icon} width="14" />
                {item.label}
              </button>
            )
          })}
        </div>

        {accounts.length > 1 && (
          <div className="px-3 pb-2">
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="h-9 w-full rounded-lg border border-[#e9edef] bg-white px-2 text-xs dark:border-white/10 dark:bg-[#1a1a1a]"
            >
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
            </select>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="grid h-40 place-items-center text-sm text-slate-400">Loading chats…</div>
          ) : conversations.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: accent?.color }}>
                <Icon icon={accent?.icon || 'mdi:whatsapp'} width="24" />
              </span>
              <p className="mt-3 text-sm font-semibold">No chats yet</p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-white/40">
                {channel === 'whatsapp'
                  ? 'WhatsApp conversations will show up here.'
                  : `Connect ${accent?.label} to see and answer those chats.`}
              </p>
              {channel !== 'whatsapp' && (
                <button type="button" onClick={() => void connect()} disabled={connecting} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-white disabled:opacity-50">
                  <Icon icon="solar:link-circle-bold" width="16" />
                  {connecting ? 'Opening…' : `Connect ${accent?.label}`}
                </button>
              )}
            </div>
          ) : conversations.map((chat) => {
            const selected = chat.id === activeId
            return (
              <button
                key={`${chat.channel}-${chat.id}`}
                type="button"
                onClick={() => setActiveId(chat.id)}
                className={`flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-3 text-start dark:border-white/5 ${selected ? rowSelected : 'hover:bg-[#f7f8fa] dark:hover:bg-white/5'}`}
              >
                <Avatar name={chat.name} channel={channel} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-medium">{chat.name}</span>
                    <span className="shrink-0 text-[11px] text-[#667781]">{formatTime(chat.lastTimestamp)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] text-[#667781] dark:text-white/45">{chat.lastMessage || 'No messages yet'}</span>
                    {chat.unread > 0 && (
                      <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white ${unreadClass}`}>{chat.unread}</span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="hidden min-w-0 flex-1 flex-col md:flex">
        {!active ? (
          <div className={`grid flex-1 place-items-center text-center ${threadBg}`}>
            <div>
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full text-white" style={{ background: accent?.color }}>
                <Icon icon={accent?.icon || 'mdi:whatsapp'} width="34" />
              </span>
              <p className="mt-4 text-lg font-medium text-slate-700 dark:text-white/80">{accent?.label}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-white/40">Select a conversation to review the AI and reply.</p>
            </div>
          </div>
        ) : (
          <>
            <header className={`flex items-center gap-3 border-b border-[#efefef] px-4 py-2.5 dark:border-white/10 ${headerBg}`}>
              <Avatar name={active.name} channel={channel} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{active.name}</p>
                <p className="text-[12px] text-[#8e8e8e]">
                  {instagram || messenger ? 'Active now' : 'online'}
                </p>
              </div>
            </header>
            {renderMessages(true)}
            {renderComposer()}
          </>
        )}
      </section>

      {active && (
        <section className={`fixed inset-0 z-20 flex flex-col md:hidden ${threadBg}`}>
          <header className={`flex items-center gap-2 px-2 py-2 ${headerBg}`}>
            <button type="button" onClick={() => setActiveId('')} className="grid h-9 w-9 place-items-center" aria-label="Back to chats">
              <Icon icon="solar:arrow-left-linear" width="20" />
            </button>
            <Avatar name={active.name} channel={channel} size={32} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{active.name}</p>
              <p className="text-[11px] text-[#8e8e8e]">{instagram || messenger ? 'Active now' : 'online'}</p>
            </div>
          </header>
          {renderMessages(false)}
          {renderComposer()}
        </section>
      )}

      {error && (
        <p className="fixed bottom-4 start-1/2 z-30 -translate-x-1/2 rounded-xl bg-rose-600 px-4 py-2 text-sm text-white shadow-lg">{error}</p>
      )}
    </div>
  )
}
