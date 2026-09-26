'use client'

import { Icon } from '@iconify/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBridge } from '@/lib/useBridge'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type MediaFile = {
  id: string
  name: string
  contentType: string
  kind: string
  size: number
  url?: string
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  }
}

export default function MediaLibrary() {
  const { getFreshToken } = useBridge()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const token = await getFreshToken()
      const response = await fetch(`${BP}/api/files`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not load files.')
      setFiles(data.files || [])
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }, [getFreshToken])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const token = await getFreshToken()
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`${BP}/api/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Upload failed.')
      setFiles((current) => [data.file, ...current.filter((item) => item.id !== data.file.id)])
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const copyReference = async (file: MediaFile) => {
    const reference = `{media:${file.name}}`
    if (await copyText(reference)) {
      setCopied(file.id)
      window.setTimeout(() => setCopied(''), 1500)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-primary dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-primary"
        aria-label="Open media library"
      >
        <Icon icon="solar:paperclip-2-linear" width="20" />
      </button>

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} aria-label="Close media library" />
          <div className="absolute bottom-12 start-0 z-50 w-[310px] rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.22)] dark:border-white/10 dark:bg-[#202026]">
            <div className="flex items-center justify-between px-1 pb-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Media library</p>
                <p className="text-[10px] text-slate-400 dark:text-white/35">FlashManager Files</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10">
                <Icon icon="solar:close-circle-linear" width="18" />
              </button>
            </div>

            <div className="grid max-h-[260px] grid-cols-3 gap-2 overflow-y-auto p-1">
              <button type="button" onClick={() => inputRef.current?.click()} className="grid aspect-square place-items-center rounded-xl border border-dashed border-slate-300 text-slate-500 hover:border-primary hover:bg-primary/10 hover:text-primary dark:border-white/15 dark:text-white/45 dark:hover:bg-primary/10" disabled={uploading}>
                <span className="text-center">
                  <Icon icon={uploading ? 'solar:refresh-circle-linear' : 'solar:add-circle-linear'} width="23" className={`mx-auto ${uploading ? 'animate-spin' : ''}`} />
                  <span className="mt-1 block text-[10px]">{uploading ? 'Uploading' : 'Add'}</span>
                </span>
              </button>
              {files.map((file) => (
                <button key={file.id} type="button" onClick={() => copyReference(file)} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5" title={`Copy {media:${file.name}}`}>
                  {file.kind === 'image' && file.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt={file.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-slate-400">
                      <Icon icon={file.kind === 'video' ? 'solar:videocamera-record-linear' : file.kind === 'audio' ? 'solar:music-note-2-linear' : 'solar:file-linear'} width="25" />
                    </span>
                  )}
                  <span className="absolute inset-x-1 bottom-1 rounded-lg bg-black/70 px-1.5 py-1 text-center text-[9px] font-medium text-white backdrop-blur-sm">
                    {copied === file.id ? 'Copied!' : 'Copy ref'}
                  </span>
                </button>
              ))}
            </div>
            {loading && <p className="py-5 text-center text-xs text-slate-400">Loading files…</p>}
            {!loading && files.length === 0 && !error && <p className="py-5 text-center text-xs text-slate-400">No files yet. Upload the first one.</p>}
            {error && <p className="px-1 pt-2 text-xs leading-4 text-rose-500">{error.replace(/^FM gateway \d+:\s*/, '')}</p>}
            <input ref={inputRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf" onChange={(event) => void upload(event.target.files?.[0])} />
          </div>
        </>
      )}
    </div>
  )
}
