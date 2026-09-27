'use client'

import { Icon } from '@iconify/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBridge } from '@/lib/useBridge'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

export type AgentChannel = 'whatsapp' | 'instagram' | 'facebook'

export type ChannelAssignment = {
  id: string
  agentId: string
  channel: AgentChannel
  endpointId: string
  displayName: string
  details: Record<string, unknown>
}

type MetaAccount = {
  id: string
  provider: 'instagram' | 'facebook'
  externalId: string
  displayName: string | null
  username: string | null
  status: string
}

type MetaPost = {
  id: string
  caption: string
  imageUrl: string | null
  timestamp: string
}

type ChannelCatalog = {
  whatsapp: {
    id: string
    displayName: string
    subtitle: string
    details: Record<string, unknown>
  } | null
  accounts: MetaAccount[]
  connectAvailable: { instagram: boolean; facebook: boolean }
}

const channelOptions: Array<{
  id: AgentChannel
  name: string
  description: string
  icon: string
  accent: string
}> = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Assign a WhatsApp Business number',
    icon: 'mdi:whatsapp',
    accent: 'bg-emerald-500 text-white',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect an Instagram professional account',
    icon: 'mdi:instagram',
    accent: 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-white',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    description: 'Connect a Facebook Page',
    icon: 'mdi:facebook',
    accent: 'bg-[#1877f2] text-white',
  },
]

export default function ChannelAssignmentModal({
  agentId,
  onClose,
  onAssigned,
}: {
  agentId: string
  onClose: () => void
  onAssigned: (assignment: ChannelAssignment) => void
}) {
  const { getFreshToken } = useBridge()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [channel, setChannel] = useState<AgentChannel | null>(null)
  const [catalog, setCatalog] = useState<ChannelCatalog | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [triggerType, setTriggerType] = useState<'all_posts' | 'specific_post'>('all_posts')
  const [posts, setPosts] = useState<MetaPost[]>([])
  const [selectedPosts, setSelectedPosts] = useState<MetaPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [postSearch, setPostSearch] = useState('')

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getFreshToken()
    if (!token) throw new Error('Could not open your account.')
    const response = await fetch(`${BP}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(String(data.error || 'Something went wrong.'))
    return data
  }, [getFreshToken])

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCatalog(await api('/api/channels', { method: 'POST', body: '{}' }))
    } catch {
      setError('Could not load your connected accounts.')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void loadCatalog()
    const rootOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = rootOverflow
    }
  }, [loadCatalog])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== 'ai-agents:oauth') return
      if (event.data?.ok) void loadCatalog()
      else setError('The account was not connected. Please try again.')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [loadCatalog])

  const accounts = useMemo(() => {
    if (!catalog || !channel) return []
    if (channel === 'whatsapp') {
      return catalog.whatsapp ? [{
        id: catalog.whatsapp.id,
        label: catalog.whatsapp.displayName,
        subtitle: catalog.whatsapp.subtitle,
      }] : []
    }
    return catalog.accounts
      .filter((account) => account.provider === channel)
      .map((account) => ({
        id: account.id,
        label: channel === 'instagram' && account.username
          ? `@${account.username}`
          : account.displayName || (channel === 'instagram' ? 'Instagram account' : 'Facebook Page'),
        subtitle: account.displayName || (channel === 'instagram' ? 'Professional account' : 'Facebook Page'),
      }))
  }, [catalog, channel])

  useEffect(() => {
    setSelectedId(accounts[0]?.id || '')
  }, [accounts])

  const connectMeta = async () => {
    if (channel !== 'instagram' && channel !== 'facebook') return
    setBusy(true)
    setError('')
    try {
      const data = await api('/api/meta/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider: channel }),
      })
      const popup = window.open(
        String(data.url),
        'ai-agents-meta-connect',
        'popup=yes,width=620,height=760,resizable=yes,scrollbars=yes',
      )
      if (!popup) setError('Please allow popups, then try again.')
    } catch {
      setError(`Could not connect ${channel === 'instagram' ? 'Instagram' : 'Facebook'} right now.`)
    } finally {
      setBusy(false)
    }
  }

  const assign = async () => {
    if (!channel || !selectedId) return
    setBusy(true)
    setError('')
    try {
      const data = await api(`/api/agents/${agentId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          channel,
          endpointId: selectedId,
          triggerType,
          selectedPosts,
        }),
      })
      onAssigned(data.assignment)
      onClose()
    } catch (reason) {
      const message = (reason as Error).message
      setError(message === 'endpoint_already_assigned'
        ? 'This account is already assigned to another AI agent.'
        : 'Could not assign this account. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const chosen = channelOptions.find((option) => option.id === channel)
  const totalSteps = channel === 'whatsapp' ? 2 : 3
  const filteredPosts = posts.filter((post) =>
    post.caption.toLowerCase().includes(postSearch.trim().toLowerCase()),
  )

  const continueFromAccount = async () => {
    if (!channel || !selectedId) return
    if (channel === 'whatsapp') {
      await assign()
      return
    }
    setLoadingPosts(true)
    setError('')
    setStep(3)
    try {
      const data = await api('/api/meta/posts', {
        method: 'POST',
        body: JSON.stringify({ accountId: selectedId }),
      })
      setPosts(Array.isArray(data.posts) ? data.posts : [])
    } catch {
      setPosts([])
      setError('Could not load posts from this account.')
    } finally {
      setLoadingPosts(false)
    }
  }

  const togglePost = (post: MetaPost) => {
    setSelectedPosts((current) =>
      current.some((item) => item.id === post.id)
        ? current.filter((item) => item.id !== post.id)
        : [...current, post],
    )
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Assign AI agent">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[3px]" onClick={onClose} aria-label="Close" />
      <div className="relative flex max-h-[min(720px,calc(100vh-24px))] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-[#e7e9ef] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-[#15151a]">
        <header className="flex items-start gap-3 border-b border-[#eef0f4] px-5 py-4 dark:border-white/10">
          {step > 1 && (
            <button type="button" onClick={() => setStep((step === 3 ? 2 : 1) as 1 | 2)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-white/55 dark:hover:bg-white/5" aria-label="Back">
              <Icon icon="solar:arrow-left-linear" width="18" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              {step === 1
                ? 'Assign AI agent'
                : step === 2
                  ? `Choose ${chosen?.name || 'account'}`
                  : 'Choose posts'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-white/40">
              {step === 1
                ? 'Choose where this agent should answer customers.'
                : step === 2
                  ? `Select the ${chosen?.name || 'account'} this agent will use.`
                  : `Choose where this agent should reply on ${chosen?.name}.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Close">
            <Icon icon="solar:close-circle-linear" width="22" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {channelOptions.map((option) => {
                const selected = channel === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setChannel(option.id)
                      setSelectedId('')
                      setTriggerType('all_posts')
                      setSelectedPosts([])
                    }}
                    className={`group relative min-h-[168px] overflow-hidden rounded-2xl border bg-white p-4 text-center transition dark:bg-white/[0.025] ${
                      selected
                        ? 'fm-choice-on border'
                        : 'border-[#e7e9ef] hover:border-[#d5d8e0] dark:border-white/10'
                    }`}
                  >
                    {selected && (
                      <span className="absolute end-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-primary text-white">
                        <Icon icon="solar:check-read-linear" width="12" />
                      </span>
                    )}
                    <span className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${option.accent}`}>
                      <Icon icon={option.icon} width="28" />
                    </span>
                    <span className="mt-5 block text-sm font-semibold text-slate-950 dark:text-white">{option.name}</span>
                    <span className="mx-auto mt-1 block max-w-[150px] text-xs leading-5 text-slate-500 dark:text-white/40">{option.description}</span>
                  </button>
                )
              })}
            </div>
          ) : step === 2 ? (loading ? (
            <div className="grid min-h-52 place-items-center text-sm text-slate-400">Loading accounts…</div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const selected = account.id === selectedId
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setSelectedId(account.id)}
                    className={`fm-choice ${selected ? 'fm-choice-on' : ''}`}
                  >
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${chosen?.accent}`}>
                      <Icon icon={chosen?.icon || 'solar:user-rounded-bold'} width="22" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950 dark:text-white">{account.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-white/40">{account.subtitle}</span>
                    </span>
                    {selected && (
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-white">
                        <Icon icon="solar:check-read-linear" width="12" />
                      </span>
                    )}
                  </button>
                )
              })}

              {!accounts.length && (
                <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-8 text-center dark:border-white/10">
                  <span className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl ${chosen?.accent}`}>
                    <Icon icon={chosen?.icon || 'solar:user-rounded-bold'} width="24" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                    {channel === 'whatsapp' ? 'No WhatsApp number connected' : `Connect ${chosen?.name}`}
                  </p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-white/40">
                    {channel === 'whatsapp'
                      ? 'Connect a WhatsApp Business number in FlashManager, then come back here.'
                      : `Connect your ${chosen?.name} account to assign it to this AI agent.`}
                  </p>
                  {channel !== 'whatsapp' && (
                    <button type="button" onClick={() => void connectMeta()} disabled={busy} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
                      <Icon icon="solar:link-circle-bold" width="18" />
                      {busy ? 'Opening…' : `Connect ${chosen?.name}`}
                    </button>
                  )}
                </div>
              )}

              {channel !== 'whatsapp' && accounts.length > 0 && (
                <button type="button" onClick={() => void connectMeta()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-white/65 dark:hover:bg-white/5">
                  <Icon icon="solar:add-circle-linear" width="18" />
                  Connect another account
                </button>
              )}
            </div>
          )) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setTriggerType('all_posts')
                    setSelectedPosts([])
                  }}
                  className={`fm-choice ${triggerType === 'all_posts' ? 'fm-choice-on' : ''}`}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon icon="solar:widget-4-bold-duotone" width="21" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-950 dark:text-white">All posts</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-white/40">Reply to comments on every post.</span>
                  </span>
                  {triggerType === 'all_posts' && (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-white">
                      <Icon icon="solar:check-read-linear" width="12" />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTriggerType('specific_post')}
                  className={`fm-choice ${triggerType === 'specific_post' ? 'fm-choice-on' : ''}`}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon icon="solar:gallery-bold-duotone" width="21" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-950 dark:text-white">Specific posts</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-white/40">Choose one or several posts.</span>
                  </span>
                  {triggerType === 'specific_post' && (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-white">
                      <Icon icon="solar:check-read-linear" width="12" />
                    </span>
                  )}
                </button>
              </div>

              {triggerType === 'specific_post' && (
                <div className="border-t border-slate-100 pt-4 dark:border-white/10">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-white/75">Select posts</p>
                      {selectedPosts.length > 0 && <p className="mt-0.5 text-[11px] text-primary">{selectedPosts.length} selected</p>}
                    </div>
                    <div className="relative max-w-[240px] flex-1">
                      <Icon icon="solar:magnifer-linear" width="16" className="absolute start-3 top-2.5 text-slate-400" />
                      <input value={postSearch} onChange={(event) => setPostSearch(event.target.value)} placeholder="Search posts…" className="h-9 w-full rounded-xl border border-slate-200 bg-white ps-9 pe-3 text-xs outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-white" />
                    </div>
                  </div>
                  {loadingPosts ? (
                    <div className="grid min-h-40 place-items-center text-sm text-slate-400">Loading posts…</div>
                  ) : (
                    <div className="grid max-h-[320px] gap-2 overflow-y-auto pe-1 sm:grid-cols-2">
                      {filteredPosts.map((post) => {
                        const selected = selectedPosts.some((item) => item.id === post.id)
                        return (
                          <button
                            key={post.id}
                            type="button"
                            onClick={() => togglePost(post)}
                            className={`fm-choice py-2.5 ${selected ? 'fm-choice-on' : ''}`}
                          >
                            {post.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={post.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                            ) : (
                              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-white/10">
                                <Icon icon="solar:gallery-linear" width="20" />
                              </span>
                            )}
                            <span className="line-clamp-2 text-xs font-medium leading-5 text-slate-800 dark:text-white/75">{post.caption}</span>
                          </button>
                        )
                      })}
                      {!filteredPosts.length && (
                        <div className="col-span-full grid min-h-28 place-items-center rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400 dark:border-white/10">
                          No posts found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#eef0f4] px-5 py-4 dark:border-white/10">
          <span className="text-xs text-slate-400">Step {step} of {totalSteps}</span>
          {step === 1 ? (
            <button type="button" disabled={!channel} onClick={() => setStep(2)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
              Next
              <Icon icon="solar:arrow-right-linear" width="17" />
            </button>
          ) : step === 2 ? (
            <button type="button" disabled={!selectedId || busy} onClick={() => void continueFromAccount()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
              <Icon icon={busy ? 'solar:refresh-circle-linear' : channel === 'whatsapp' ? 'solar:link-circle-bold' : 'solar:arrow-right-linear'} width="17" className={busy ? 'animate-spin' : ''} />
              {busy ? 'Assigning…' : channel === 'whatsapp' ? 'Assign agent' : 'Next'}
            </button>
          ) : (
            <button type="button" disabled={busy || (triggerType === 'specific_post' && selectedPosts.length === 0)} onClick={() => void assign()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
              <Icon icon={busy ? 'solar:refresh-circle-linear' : 'solar:link-circle-bold'} width="17" className={busy ? 'animate-spin' : ''} />
              {busy ? 'Assigning…' : 'Assign agent'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
