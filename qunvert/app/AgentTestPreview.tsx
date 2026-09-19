'use client'

import { Icon } from '@iconify/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import type { Product } from '@/lib/products'
import { useBridge } from '@/lib/useBridge'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type Message = { id: number; from: 'customer' | 'agent' | 'system'; text: string }

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
    () => (opener ? [{ id: 1, from: 'agent', text: opener }] : []),
    [opener],
  )
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<Message[]>(initial)
  const threadRef = useRef<HTMLDivElement>(null)
  const draftKey = `${agentId}:${opener}`

  useEffect(() => {
    setMessages(initial)
    setInput('')
  }, [draftKey, initial])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const customerMessage: Message = { id: Date.now(), from: 'customer', text }
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
          history: previous.map((message) => ({
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
          { id: Date.now() + 1, from: 'system', text: 'No reply sent — this conversation is out of context.' },
        ])
        return
      }
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, from: 'agent', text: String(data.reply || 'No reply generated.') },
      ])
    } catch {
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, from: 'agent', text: 'Preview is temporarily unavailable. Try again.' },
      ])
    } finally {
      setSending(false)
    }
  }

  const reset = () => {
    setMessages(initial)
    setInput('')
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[292px]">
        <span className="absolute -start-[3px] top-[108px] h-8 w-[3px] rounded-r-sm bg-[#2a2a2e]" />
        <span className="absolute -start-[3px] top-[148px] h-[52px] w-[3px] rounded-r-sm bg-[#2a2a2e]" />
        <span className="absolute -end-[3px] top-[136px] h-[72px] w-[3px] rounded-l-sm bg-[#2a2a2e]" />
        <div className="relative overflow-hidden rounded-[42px] bg-[#111113] p-[10px] shadow-[0_28px_70px_rgba(15,23,42,0.28)] ring-1 ring-black/40">
          <div className="relative overflow-hidden rounded-[32px] bg-[#efeae2]">
            <div className="absolute inset-x-0 top-0 z-20 flex h-11 items-end justify-between px-6 pb-1 text-[11px] font-semibold text-white">
              <span>9:41</span>
              <span className="flex items-center gap-1 text-[10px]">
                <Icon icon="solar:wifi-router-bold" width="12" />
                <Icon icon="solar:battery-full-bold" width="14" />
              </span>
            </div>
            <div className="absolute left-1/2 top-[10px] z-30 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-black shadow-inner" />

            <div className="flex items-center gap-2.5 bg-[#075e54] px-3 pb-3 pt-12 text-white">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15">
                <Icon icon="solar:stars-minimalistic-bold-duotone" width="16" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-4">{agentName || 'AI sales agent'}</p>
                <p className="text-[10px] text-emerald-100/80">online · AI test</p>
              </div>
              <button type="button" onClick={reset} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10" aria-label="Reset preview">
                <Icon icon="solar:refresh-linear" width="16" />
              </button>
            </div>

            <div className="flex h-[390px] flex-col bg-[url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Cpath fill=%22%23d7cfc7%22 fill-opacity=%22.35%22 d=%22M0 0h60v60H0z%22/%3E%3C/svg%3E')] bg-[#ece5dd]">
              <div ref={threadRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
                {!messages.length && (
                  <p className="mx-auto max-w-[200px] rounded-lg bg-white/80 px-3 py-2 text-center text-[10px] leading-4 text-slate-500 shadow-sm">
                    Send a message to test this agent’s live GPT replies.
                  </p>
                )}
                {messages.map((message) => (
                  message.from === 'system' ? (
                    <p key={message.id} className="mx-auto max-w-[210px] rounded-lg bg-white/80 px-3 py-1.5 text-center text-[10px] leading-4 text-slate-500 shadow-sm">
                      {message.text}
                    </p>
                  ) : (
                  <div key={message.id} className={`flex ${message.from === 'customer' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-xl px-2.5 py-1.5 text-[12px] leading-5 shadow-sm ${
                      message.from === 'customer'
                        ? 'rounded-tr-sm bg-[#d9fdd3] text-slate-800'
                        : 'rounded-tl-sm bg-white text-slate-800'
                    }`}>
                      {message.text}
                    </div>
                  </div>
                  )
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[11px] text-slate-400 shadow-sm">Typing…</div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 bg-[#f0f2f5] px-2 py-2">
                <div className="flex h-9 min-w-0 flex-1 items-center rounded-full bg-white px-3">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void send()
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
                    placeholder="Type a test message"
                  />
                </div>
                <button type="button" onClick={() => void send()} disabled={sending} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25d366] text-white disabled:opacity-50" aria-label="Send test message">
                  <Icon icon={sending ? 'solar:refresh-circle-linear' : 'solar:plain-2-bold'} width="16" className={sending ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex justify-center bg-[#f0f2f5] pb-2 pt-1">
                <span className="h-1 w-24 rounded-full bg-black/80" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-[280px] text-center text-[11px] leading-4 text-slate-500 dark:text-white/40">
        Live test of this agent’s current prompt, products, and GPT model. Nothing is sent on WhatsApp.
      </p>
    </div>
  )
}
