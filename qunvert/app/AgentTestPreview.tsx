'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import type { Product } from '@/lib/products'
import { useBridge } from '@/lib/useBridge'
import { Bubble, DayChip, PhoneFrame, TypingIndicator, WA_ICONS, renderWhatsAppMessage } from './WhatsAppPhone'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type Message = { id: number; from: 'customer' | 'agent' | 'system'; text: string; time: string; error?: boolean }

const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function AgentTestPreview({
  agentName,
  agentId,
  config,
  products,
}: {
  agentName: string
  agentId: string
  config: AgentConfiguration
  products: Product[]
}) {
  const { getFreshToken } = useBridge()
  const opener = config.autoReplyOpener.trim()
  const initial = useMemo<Message[]>(
    () => (opener ? [{ id: 1, from: 'agent', text: opener, time: '9:41 AM' }] : []),
    [opener],
  )
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<Message[]>(initial)
  const bodyRef = useRef<HTMLDivElement>(null)
  const draftKey = `${agentId}:${opener}`

  useEffect(() => {
    setMessages(initial)
    setInput('')
  }, [draftKey, initial])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const customerMessage: Message = { id: Date.now(), from: 'customer', text, time: now() }
    const previous = messages
    setMessages((current) => [...current, customerMessage])
    setInput('')
    setSending(true)
    try {
      const token = await getFreshToken()
      const response = await fetch(`${BP}/api/agents/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agentId,
          name: agentName,
          policies: config,
          products: config.allProducts ? undefined : products,
          message: text,
          history: previous
            .filter((message) => message.from !== 'system')
            .map((message) => ({
              role: message.from === 'agent' ? 'assistant' : 'user',
              text: message.text,
            })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Preview failed')
      if (data.skipped) {
        setMessages((current) => [
          ...current,
          { id: Date.now() + 1, from: 'system', text: 'No reply sent — this conversation is out of context.', time: now() },
        ])
        return
      }
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, from: 'agent', text: String(data.reply || 'No reply generated.'), time: now() },
      ])
    } catch {
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, from: 'agent', text: 'Preview is temporarily unavailable. Try again.', time: now(), error: true },
      ])
    } finally {
      setSending(false)
    }
  }

  const reset = () => {
    setMessages(initial)
    setInput('')
  }

  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      className="flex items-center gap-2 bg-[#F0F0F0] px-2.5 py-2"
    >
      {WA_ICONS.emoji('h-4 w-4 shrink-0 text-[#54656F]')}
      <input
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }}
        disabled={sending}
        dir="auto"
        className="min-w-0 flex-1 rounded-full bg-white px-3 py-1.5 text-[10px] text-gray-700 outline-none placeholder:text-gray-400 disabled:opacity-60"
        placeholder="Type a message"
      />
      <button
        type="submit"
        disabled={sending || !input.trim()}
        aria-label="Send"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#00A884] text-white disabled:opacity-40"
      >
        {sending ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          WA_ICONS.send('h-3 w-3')
        )}
      </button>
    </form>
  )

  return (
    <div className="flex flex-col items-center">
      <PhoneFrame contactName={agentName || 'AI agent'} online="online" bodyRef={bodyRef} footer={composer}>
        <DayChip onClick={reset}>Test mode · tap to reset</DayChip>
        {!messages.length && (
          <p className="mx-auto mb-2 max-w-[200px] rounded-md bg-white/90 px-3 py-1.5 text-center text-[10px] leading-4 text-gray-500 shadow-sm">
            Send a message to test this agent’s live replies.
          </p>
        )}
        {messages.map((message) =>
          message.from === 'system' ? (
            <p key={message.id} className="mx-auto mb-1.5 max-w-[210px] rounded-md bg-white/90 px-3 py-1 text-center text-[10px] leading-4 text-gray-500 shadow-sm">
              {message.text}
            </p>
          ) : message.from === 'agent' ? (
            <Bubble key={message.id} direction="in" time={message.time} error={message.error} html={renderWhatsAppMessage(message.text)} />
          ) : (
            <Bubble key={message.id} direction="out" time={message.time}>
              {message.text}
            </Bubble>
          ),
        )}
        {sending && <TypingIndicator />}
      </PhoneFrame>
      <p className="mt-3 max-w-[280px] text-center text-[11px] leading-4 text-slate-500 dark:text-white/40">
        Live test of this agent’s current prompt, products, and model. Nothing is sent on WhatsApp.
      </p>
    </div>
  )
}
