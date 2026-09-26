'use client'

import { Icon } from '@iconify/react'
import { useEffect, useRef, useState } from 'react'
import { useBridge } from '@/lib/useBridge'
import type { ProductBrief } from '@/lib/ai'
import {
  createQuestionnairePair,
  type QuestionnaireAnswer,
  type QuestionnaireMedia,
  type QuestionnaireState,
} from '@/lib/questionnaire'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
  media?: QuestionnaireMedia[]
}

function mediaIcon(kind: QuestionnaireMedia['kind']) {
  if (kind === 'audio') return 'solar:microphone-3-bold'
  if (kind === 'video') return 'solar:videocamera-record-bold'
  if (kind === 'image') return 'solar:gallery-bold'
  return 'solar:file-bold'
}

function AnswerComposer({
  value,
  onChange,
  onAttach,
  onToggleRecord,
  onSend,
  recording,
  uploading,
  sending,
  placeholder,
  media,
  onRemoveMedia,
}: {
  value: string
  onChange: (value: string) => void
  onAttach: () => void
  onToggleRecord: () => void
  onSend?: () => void
  recording: boolean
  uploading: boolean
  sending?: boolean
  placeholder: string
  media?: QuestionnaireMedia[]
  onRemoveMedia?: (index: number) => void
}) {
  return (
    <div className="rounded-[32px] border border-[#e5e7eb] bg-white px-5 pb-3.5 pt-4 dark:border-white/12 dark:bg-[#1b1b20]">
      <textarea
        rows={2}
        dir="auto"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (onSend && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        className="min-h-[44px] w-full resize-none bg-transparent text-[15px] leading-6 text-slate-800 outline-none placeholder:text-[#b0b4ba] dark:text-white dark:placeholder:text-white/35"
      />
      <MediaChips files={media || []} onRemove={onRemoveMedia} />
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onAttach}
          disabled={uploading || sending}
          className="grid h-8 w-8 place-items-center text-[#9aa0a6] transition hover:text-slate-600 disabled:opacity-40 dark:text-white/40 dark:hover:text-white/70"
          aria-label="Attach media"
        >
          <Icon icon={uploading ? 'solar:refresh-circle-linear' : 'solar:paperclip-linear'} width="20" className={uploading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={onToggleRecord}
          disabled={uploading || sending}
          className={`grid h-8 w-8 place-items-center transition disabled:opacity-40 ${
            recording ? 'text-rose-500' : 'text-[#9aa0a6] hover:text-slate-600 dark:text-white/40 dark:hover:text-white/70'
          }`}
          aria-label={recording ? 'Stop recording' : 'Record audio answer'}
        >
          <Icon icon={recording ? 'solar:stop-bold' : 'solar:soundwave-linear'} width="22" />
        </button>
      </div>
    </div>
  )
}

function MediaChips({
  files,
  onRemove,
}: {
  files: QuestionnaireMedia[]
  onRemove?: (index: number) => void
}) {
  if (!files.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          <Icon icon={mediaIcon(file.kind)} width="13" />
          <span className="max-w-[160px] truncate">{file.name}</span>
          {onRemove && (
            <button type="button" onClick={() => onRemove(index)} className="text-primary/70 hover:text-primary" aria-label={`Remove ${file.name}`}>
              <Icon icon="solar:close-circle-linear" width="14" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-white/[0.06]">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-white/40"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export default function QuestionnaireChat({
  storeName,
  products,
  language,
  value,
  onChange,
  onReady,
  onSkipStep,
  busy = false,
}: {
  storeName?: string | null
  products: ProductBrief[]
  language?: string | null
  value: QuestionnaireState
  onChange: (next: QuestionnaireState) => void
  onReady: (ready: boolean) => void
  /** Called when the seller skips or finishes: the wizard creates the agent. */
  onSkipStep?: () => void
  /** The wizard is building the prompt / saving. */
  busy?: boolean
}) {
  const { getFreshToken } = useBridge()
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedRef = useRef(false)

  const [phase, setPhase] = useState<'loading' | 'interview' | 'done'>('loading')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pendingMedia, setPendingMedia] = useState<QuestionnaireMedia[]>([])
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const uploadFile = async (file: File, transcribe = false) => {
    const token = await getFreshToken()
    if (!token) throw new Error('no_token')
    const body = new FormData()
    body.append('file', file)
    const response = await fetch(`${BP}/api/files${transcribe ? '?transcribe=1' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Upload failed.')
    const uploaded = data.file as { id?: string; name: string; kind?: string; contentType?: string }
    return {
      id: uploaded.id,
      name: uploaded.name,
      kind: (uploaded.kind === 'image' || uploaded.kind === 'video' || uploaded.kind === 'audio' ? uploaded.kind : 'file') as QuestionnaireMedia['kind'],
      contentType: uploaded.contentType,
    } satisfies QuestionnaireMedia
  }

  const attachPickedFile = async (file?: File) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const media = await uploadFile(file, file.type.startsWith('audio/'))
      setPendingMedia((current) => [...current, media])
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const stopRecorder = () => {
    recorderRef.current?.stop()
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
    setRecording(false)
  }

  const toggleRecord = async () => {
    if (recording) {
      stopRecorder()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `seller-answer-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' })
        void attachPickedFile(file)
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setError('')
    } catch {
      setError('Microphone access is needed to record an answer.')
    }
  }

  const finish = (text: string) => {
    setPhase('done')
    onReady(true)
    setMessages((current) => [...current, { id: `done-${Date.now()}`, role: 'assistant', text }])
  }

  const askNextQuestion = async (interview: QuestionnaireAnswer[]) => {
    const token = await getFreshToken()
    if (!token) throw new Error('no_token')
    const response = await fetch(`${BP}/api/agents/questionnaire`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        storeName,
        products,
        language,
        common: value.common,
        interview,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not generate the next question.')
    if (data.done || !data.question) {
      finish('That covers what your customers usually ask. Click Create — the agent writes its instructions from these answers, including any audio or files you attached.')
      return
    }
    setPhase('interview')
    onReady(true)
    setMessages((current) => [
      ...current,
      { id: `q-${Date.now()}`, role: 'assistant', text: String(data.question) },
    ])
  }

  // Open the chat with GPT-5.6 already in character, having read the products.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    onReady(true)
    if (value.interview.length) {
      setMessages(value.interview.flatMap((entry) => [
        { id: `${entry.id}-q`, role: 'assistant' as const, text: entry.question },
        { id: entry.id, role: 'user' as const, text: entry.answer || (entry.media.length ? 'Sent media answer' : ''), media: entry.media },
      ]))
    }
    setSending(true)
    askNextQuestion(value.interview)
      .catch((reason) => {
        setError((reason as Error).message)
        setPhase('interview')
        setMessages((current) => [
          ...current,
          { id: `fallback-${Date.now()}`, role: 'assistant', text: 'Hi! How long does delivery take, and do you deliver to my city?' },
        ])
      })
      .finally(() => setSending(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => stopRecorder(), [])

  // Skip creates the agent right away; its instructions are built from the products and any answers so far.
  const skipInterview = () => {
    if (onSkipStep) {
      onSkipStep()
      return
    }
    finish('No problem. The agent’s instructions will be built from your products when you create it.')
  }

  const submitInterview = async () => {
    const last = [...messages].reverse().find((item) => item.role === 'assistant')
    const question = last?.text || 'Customer question'
    if (!draft.trim() && !pendingMedia.length) {
      setError('Type an answer, attach a file, or record audio.')
      return
    }
    setSending(true)
    setError('')
    const entry: QuestionnaireAnswer = {
      id: createQuestionnairePair('interview').id,
      question,
      answer: draft.trim(),
      media: pendingMedia,
      source: 'interview',
    }
    const nextInterview = [...value.interview, entry]
    onChange({ ...value, interview: nextInterview })
    setMessages((current) => [
      ...current,
      { id: entry.id, role: 'user', text: entry.answer || (entry.media.length ? 'Sent media answer' : ''), media: entry.media },
    ])
    setDraft('')
    setPendingMedia([])
    try {
      await askNextQuestion(nextInterview)
    } catch (reason) {
      setError((reason as Error).message)
      finish('Thanks — that is enough. Click Create to build the agent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#111116]">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Icon icon="solar:user-speak-rounded-bold-duotone" width="20" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-950 dark:text-white">Customer simulation</p>
          <p className="mt-0.5 text-xs leading-4 text-slate-500 dark:text-white/40">
            Your AI studied {products.length ? `${products.length} selected product${products.length === 1 ? '' : 's'}` : 'your store'} and asks what real customers would. Answer with text, a file, or audio.
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-5 sm:px-5">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.role === 'user'
                ? 'bg-primary text-white'
                : 'bg-slate-50 text-slate-800 dark:bg-white/[0.06] dark:text-white/85'
            }`}>
              <p dir="auto" className="whitespace-pre-wrap [unicode-bidi:plaintext]">{message.text}</p>
              <MediaChips files={message.media || []} />
            </div>
          </div>
        ))}

        {sending && <TypingBubble />}

        {phase === 'interview' && (
          <div className="pt-1">
            <AnswerComposer
              value={draft}
              onChange={setDraft}
              onAttach={() => fileRef.current?.click()}
              onToggleRecord={() => void toggleRecord()}
              onSend={() => void submitInterview()}
              recording={recording}
              uploading={uploading}
              sending={sending}
              placeholder="Answer like you would to this customer — text, media, or both"
              media={pendingMedia}
              onRemoveMedia={(index) => setPendingMedia((current) => current.filter((_, currentIndex) => currentIndex !== index))}
            />
            <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-white/30">Press Enter to send. Shift+Enter for a new line.</p>
          </div>
        )}
      </div>

      {error && <p className="px-5 pb-2 text-xs text-rose-500">{error.replace(/^FM gateway \d+:\s*/, '')}</p>}

      {phase !== 'done' && (
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={skipInterview}
            disabled={uploading || busy}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5"
          >
            {busy ? 'Creating…' : 'Skip & create'}
          </button>
          <button
            type="button"
            onClick={() => void submitInterview()}
            disabled={sending || uploading || busy || phase === 'loading'}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-[0_8px_24px_rgba(59,189,181,0.28)] hover:bg-primary-hover disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send answer'}
            <Icon icon="solar:plain-2-bold" width="16" />
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf"
        onChange={(event) => void attachPickedFile(event.target.files?.[0])}
      />
    </div>
  )
}
