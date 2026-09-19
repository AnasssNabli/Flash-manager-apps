'use client'

import { Icon } from '@iconify/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBridge } from '@/lib/useBridge'
import { useI18n } from '@/lib/useI18n'
import type { Product } from '@/lib/products'
import type { Store } from '@/lib/stores'
import AgentBuilder, { type AgentConfiguration, type AgentPayload } from './AgentBuilder'
import AgentDetail from './AgentDetail'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

type Agent = {
  id: string
  name: string
  storeName: string | null
  productScope: string
  productId: string | null
  productName: string | null
  productImage: string | null
  productJson: string | null
  policiesJson: string | null
  enabled: boolean
  createdAt: string
}

type Reply = {
  id: string
  phone: string
  inbound: string
  outbound: string
  status: string
}

type ConnectedWhatsApp = {
  connected?: boolean
  isShared?: boolean
  tokenExpired?: boolean
  phone?: { displayPhone?: string; verifiedName?: string } | null
}

function parseConfiguration(agent: Agent): Partial<AgentConfiguration> {
  try {
    return agent.policiesJson ? JSON.parse(agent.policiesJson) : {}
  } catch {
    return {}
  }
}

function productCount(agent: Agent, config: Partial<AgentConfiguration>) {
  if (Array.isArray(config.productIds) && config.productIds.length) return config.productIds.length
  try {
    const products = agent.productJson ? JSON.parse(agent.productJson) : []
    if (Array.isArray(products) && products.length) return products.length
  } catch {
    // Older agents may not have structured products.
  }
  return agent.productId || agent.productName ? 1 : 0
}

function formatWhatsAppNumber(raw?: string | null) {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (value.startsWith('+')) return value
  const digits = value.replace(/\D/g, '')
  return digits ? `+${digits}` : value
}

function purposeLabel(config: Partial<AgentConfiguration>) {
  if (config.purpose === 'support') return 'Customer support'
  if (config.purpose === 'leads') return 'Generate leads'
  return config.tag || 'Sales agent'
}

function AgentCard({
  agent,
  whatsapp,
  confirming,
  deleting,
  onOpen,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  agent: Agent
  whatsapp: ConnectedWhatsApp
  confirming: boolean
  deleting: boolean
  onOpen: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const config = parseConfiguration(agent)
  const count = productCount(agent, config)
  const allProducts = config.allProducts === true
  const connected = Boolean(whatsapp.connected && !whatsapp.tokenExpired)
  const live = connected && agent.enabled && config.desiredStatus !== 'paused'
  const number = formatWhatsAppNumber(whatsapp.phone?.displayPhone || config.whatsappNumber)
  const waName = whatsapp.phone?.verifiedName || ''

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-[border-color,box-shadow] duration-200 hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25D366]/10 text-[#128C7E] dark:bg-[#25D366]/15">
          <Icon icon="logos:whatsapp-icon" width="22" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-slate-950 dark:text-white">{agent.name}</h3>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              live
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/45'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {live ? 'Live' : 'Paused'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-white/40">{purposeLabel(config)}</p>
        </div>
      </div>

      <div className={`mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        connected
          ? 'bg-[#25D366]/10 dark:bg-[#25D366]/10'
          : 'bg-amber-50 dark:bg-amber-500/10'
      }`}>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white dark:bg-black/20 ${
          connected ? 'text-[#128C7E]' : 'text-amber-600'
        }`}>
          <Icon icon="solar:phone-bold" width="16" />
        </span>
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${connected ? 'text-slate-900 dark:text-white' : 'text-amber-800 dark:text-amber-200'}`}>
            {number || 'No WhatsApp number'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-white/40">
            {connected ? (waName || 'Connected number') : 'Connect WhatsApp to go live'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-slate-500 dark:text-white/40">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon icon="solar:box-minimalistic-linear" width="15" className="shrink-0" />
          <span className="truncate">{allProducts ? 'All products' : `${count || 0} products`}</span>
        </span>
        <span className="h-3 w-px bg-slate-200 dark:bg-white/10" />
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon icon="solar:shop-linear" width="15" className="shrink-0" />
          <span className="truncate">{agent.storeName || 'Main catalog'}</span>
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        {confirming ? (
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs font-medium text-rose-600 dark:text-rose-300">Delete this agent?</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                disabled={deleting}
                className="h-10 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-white/50 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleting}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onAskDelete}
              className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
              aria-label={`Delete ${agent.name}`}
            >
              <Icon icon="solar:trash-bin-trash-linear" width="18" />
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(109,94,246,0.28)] transition hover:bg-primary-hover"
            >
              Manage
              <Icon icon="solar:arrow-right-linear" width="15" />
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default function Page() {
  const { t } = useI18n()
  const { ready, getFreshToken } = useBridge()
  const embedded = typeof window === 'undefined' || window.self !== window.top
  const [loading, setLoading] = useState(true)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [replies, setReplies] = useState<Reply[]>([])
  const [waiting, setWaiting] = useState(0)
  const [whatsapp, setWhatsapp] = useState<ConnectedWhatsApp>({})
  const [stores, setStores] = useState<Store[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [waLabels, setWaLabels] = useState<{ id: string; name: string }[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getFreshToken()
      if (!token) throw new Error('no_token')
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
      if (!response.ok) throw new Error(data.error || `http_${response.status}`)
      return data
    },
    [getFreshToken],
  )

  const load = useCallback(async () => {
    const data = await api('/api/session', { method: 'POST', body: '{}' })
    setAgents(data.agents || [])
    setReplies(data.replies || [])
    setWaiting(Number(data.waiting || 0))
    setWhatsapp(data.status || {})
  }, [api])

  useEffect(() => {
    if (!ready) return
    load()
      .catch(() => setNotice(t('error')))
      .finally(() => setLoading(false))
  }, [ready, load, t])

  const openBuilder = async () => {
    setBuilderOpen(true)
    setNotice('')
    setLoadingProducts(true)
    try {
      const [storeData, productData, labelData] = await Promise.all([
        api('/api/stores'),
        api('/api/products'),
        api('/api/whatsapp-labels').catch(() => ({ labels: [] })),
      ])
      setStores(storeData.stores || [])
      setProducts(productData.products || [])
      setWaLabels(Array.isArray(labelData.labels) ? labelData.labels : [])
    } catch {
      setNotice('We could not load your full catalog. You can close this page and try again.')
    } finally {
      setLoadingProducts(false)
    }
  }

  const saveAgent = async (payload: AgentPayload) => {
    setBusy(true)
    setNotice('')
    try {
      const data = await api('/api/agents', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setAgents((current) => [data.agent, ...current])
      setBuilderOpen(false)
      setSelectedAgent(data.agent)
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const openAgent = async (agent: Agent) => {
    setSelectedAgent(agent)
    if (products.length) return
    api('/api/products')
      .then((data) => setProducts(data.products || []))
      .catch(() => {})
  }

  const updateAgent = async (agent: Agent, payload: Record<string, unknown>) => {
    const data = await api(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    setAgents((current) => current.map((item) => item.id === agent.id ? data.agent : item))
    setSelectedAgent(data.agent)
  }

  const deleteAgent = async (agent: Agent) => {
    setDeletingId(agent.id)
    setNotice('')
    try {
      await api(`/api/agents/${agent.id}`, { method: 'DELETE' })
      setAgents((current) => current.filter((item) => item.id !== agent.id))
      setConfirmingId(null)
      if (selectedAgent?.id === agent.id) setSelectedAgent(null)
    } catch {
      setNotice('Could not delete this agent.')
    } finally {
      setDeletingId(null)
    }
  }

  const configuredProducts = useMemo(
    () => agents.reduce((total, agent) => total + productCount(agent, parseConfiguration(agent)), 0),
    [agents],
  )

  if (!embedded) {
    return (
      <div className="min-h-screen grid place-items-center p-8 text-center text-sm text-black/50 dark:text-white/50">
        {t('openFromFM')}
      </div>
    )
  }

  if (!ready || loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f7f7fa] dark:bg-black">
        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-white/45">
          <span className="grid h-9 w-9 animate-pulse place-items-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
            <Icon icon="solar:stars-minimalistic-bold-duotone" width="20" />
          </span>
          {t('connecting')}
        </div>
      </div>
    )
  }

  if (builderOpen) {
    return (
      <>
        <AgentBuilder
          stores={stores}
          products={products}
          loadingProducts={loadingProducts}
          busy={busy}
          whatsapp={whatsapp}
          waLabels={waLabels}
          onCancel={() => setBuilderOpen(false)}
          onSave={saveAgent}
        />
        {notice && (
          <div className="fixed bottom-5 start-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-4 py-3 text-sm text-white shadow-2xl">
            {notice}
          </div>
        )}
      </>
    )
  }

  if (selectedAgent) {
    return (
      <AgentDetail
        agent={selectedAgent}
        catalogProducts={products}
        whatsapp={whatsapp}
        onBack={() => setSelectedAgent(null)}
        onSave={(payload) => updateAgent(selectedAgent, payload)}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[#f7f7fa] px-4 py-6 sm:px-6 sm:py-9 dark:bg-black">
      <div className="mx-auto max-w-[1180px]">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
                <Icon icon="solar:stars-minimalistic-bold-duotone" width="15" />
              </span>
              Qunvert AI
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-[38px] dark:text-white">AI agents</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 sm:text-base dark:text-white/45">
              Create focused WhatsApp agents that understand your catalog, capture orders, and hand conversations back to your team.
            </p>
          </div>
          <button
            type="button"
            onClick={openBuilder}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(109,94,246,0.30)] transition hover:-translate-y-0.5 hover:bg-violet-700"
          >
            <Icon icon="solar:add-circle-bold" width="19" />
            Create AI agent
          </button>
        </header>

        <section className={`mt-6 rounded-[22px] border p-4 sm:p-5 ${whatsapp.connected && !whatsapp.tokenExpired ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/10' : 'border-amber-200 bg-amber-50/80 dark:border-amber-500/20 dark:bg-amber-500/10'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-2xl ${whatsapp.connected && !whatsapp.tokenExpired ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'}`}>
                <Icon icon="solar:chat-round-dots-bold-duotone" width="22" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">
                  {whatsapp.connected && !whatsapp.tokenExpired
                    ? whatsapp.phone?.verifiedName || 'WhatsApp Business connected'
                    : 'WhatsApp is not connected'}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-white/45">
                  {whatsapp.connected && !whatsapp.tokenExpired
                    ? `${whatsapp.phone?.displayPhone || 'Connected number'} · replies run in the background while this number stays connected`
                    : 'Connect a number in WhatsApp Business before activating an agent. Saved agents stay paused until then.'}
                </p>
              </div>
            </div>
            {whatsapp.isShared && (
              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/50">Shared number</span>
            )}
          </div>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[20px] border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-white/40">AI agents</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><Icon icon="solar:stars-minimalistic-bold-duotone" width="17" /></span>
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{agents.length}</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/30">Configurations saved</p>
          </div>
          <div className="rounded-[20px] border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-white/40">Assigned products</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"><Icon icon="solar:box-minimalistic-bold-duotone" width="17" /></span>
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{configuredProducts}</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/30">Across all agents</p>
          </div>
          <div className="rounded-[20px] border border-slate-200/70 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-white/40">Waiting chats</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"><Icon icon="solar:chat-round-dots-bold-duotone" width="17" /></span>
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{waiting}</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-white/30">Ready for the processing phase</p>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">Your agents</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-white/40">Each agent has its own products, personality, and safeguards.</p>
            </div>
          </div>

          {agents.length === 0 ? (
            <div className="relative overflow-hidden rounded-[28px] border border-dashed border-violet-200 bg-white px-6 py-16 text-center dark:border-violet-500/25 dark:bg-white/[0.035]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(109,94,246,0.12),transparent_45%)]" />
              <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-[20px] bg-violet-100 text-violet-600 shadow-[0_12px_30px_rgba(109,94,246,0.18)] dark:bg-violet-500/20 dark:text-violet-200">
                <Icon icon="solar:stars-minimalistic-bold-duotone" width="32" />
              </span>
              <h3 className="relative mt-5 text-lg font-semibold text-slate-950 dark:text-white">Create your first AI agent</h3>
              <p className="relative mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-white/45">
                Assign products and configure the exact way your agent should respond, follow up, capture orders, and involve your team.
              </p>
              <button type="button" onClick={openBuilder} className="relative mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(109,94,246,0.28)] hover:bg-violet-700">
                <Icon icon="solar:add-circle-bold" width="19" />
                Create AI agent
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  whatsapp={whatsapp}
                  confirming={confirmingId === agent.id}
                  deleting={deletingId === agent.id}
                  onOpen={() => void openAgent(agent)}
                  onAskDelete={() => setConfirmingId(agent.id)}
                  onCancelDelete={() => setConfirmingId(null)}
                  onConfirmDelete={() => void deleteAgent(agent)}
                />
              ))}
            </div>
          )}
        </section>

        {replies.length > 0 && (
          <section className="mt-8 rounded-[24px] border border-slate-200/80 bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-950 dark:text-white">Recent activity</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-white/40">Messages from the existing responder.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-white/10 dark:text-white/45">{replies.length}</span>
            </div>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-white/10">
              {replies.slice(0, 4).map((reply) => (
                <div key={reply.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <Icon icon="solar:chat-round-line-linear" width="18" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-white/70">{reply.phone}</p>
                    <p className="mt-1 truncate text-xs text-slate-400 dark:text-white/30">{reply.inbound}</p>
                    {reply.status !== 'sent' && (
                      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-amber-600 dark:text-amber-300">
                        {reply.status === 'donotanswer' ? 'Not sent · out of context' : reply.status.replace(/_/g, ' ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {notice && <p className="mt-5 text-center text-sm text-rose-500">{notice}</p>}
      </div>
    </main>
  )
}
