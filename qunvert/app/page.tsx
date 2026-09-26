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

function purposeLabel(_config: Partial<AgentConfiguration>) {
  return 'Customer support & order changes'
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
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 transition-[border-color,box-shadow] duration-200 hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary dark:bg-primary/20">
          <Icon icon="mdi:whatsapp" width="18" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">{agent.name}</h3>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              live
                ? 'bg-primary/15 text-primary dark:bg-primary/15 dark:text-primary'
                : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/45'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-primary' : 'bg-slate-400'}`} />
              {live ? 'Live' : 'Paused'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-white/40">{purposeLabel(config)}</p>
        </div>
      </div>

      <div className={`mt-3 flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${
        connected
          ? 'bg-primary/10 dark:bg-primary/10'
          : 'bg-amber-50 dark:bg-amber-500/10'
      }`}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white dark:bg-black/20 ${
          connected ? 'text-primary' : 'text-amber-600'
        }`}>
          <Icon icon="solar:phone-bold" width="14" />
        </span>
        <div className="min-w-0">
          <p className={`truncate text-[13px] font-semibold ${connected ? 'text-slate-900 dark:text-white' : 'text-amber-800 dark:text-amber-200'}`}>
            {number || 'No WhatsApp number'}
          </p>
          <p className="truncate text-[11px] text-slate-500 dark:text-white/40">
            {connected ? (waName || 'Connected number') : 'Connect WhatsApp to go live'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/40">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon icon="solar:box-minimalistic-linear" width="13" className="shrink-0" />
          <span className="truncate">{allProducts ? 'All products' : `${count || 0} products`}</span>
        </span>
        <span className="h-3 w-px bg-slate-200 dark:bg-white/10" />
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon icon="solar:shop-linear" width="13" className="shrink-0" />
          <span className="truncate">{agent.storeName || 'Main catalog'}</span>
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        {confirming ? (
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-rose-600 dark:text-rose-300">Delete this agent?</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                disabled={deleting}
                className="h-9 rounded-xl px-3 text-[13px] font-medium text-slate-500 hover:bg-slate-100 dark:text-white/50 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleting}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
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
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
              aria-label={`Delete ${agent.name}`}
            >
              <Icon icon="solar:trash-bin-trash-linear" width="16" />
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(59,189,181,0.28)] transition hover:bg-primary-hover"
            >
              Manage
              <Icon icon="solar:arrow-right-linear" width="14" />
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default function Page() {
  const { t, locale } = useI18n()
  const { ready, getFreshToken } = useBridge()
  const embedded = typeof window === 'undefined' || window.self !== window.top
  const [loading, setLoading] = useState(true)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [waiting, setWaiting] = useState(0)
  const [whatsapp, setWhatsapp] = useState<ConnectedWhatsApp>({})
  const [stores, setStores] = useState<Store[]>([])
  const [products, setProducts] = useState<Product[]>([])
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
      const [storeData, productData] = await Promise.all([
        api('/api/stores'),
        api('/api/products'),
      ])
      setStores(storeData.stores || [])
      setProducts(productData.products || [])
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
      if (payload.policies?.submitVariantsForApproval && data.carousel && data.carousel.ok === false) {
        setNotice('Agent saved. Meta has not accepted the variant carousel template yet — it will be retried on the next save.')
      }
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
    return data.agent as Agent
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
          <span className="grid h-9 w-9 animate-pulse place-items-center rounded-xl bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary">
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
          locale={locale}
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
        locale={locale}
        onBack={() => setSelectedAgent(null)}
        onSave={(payload) => updateAgent(selectedAgent, payload)}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[#f7f7fa] px-4 py-5 sm:px-6 sm:py-6 dark:bg-black">
      <div className="mx-auto max-w-[1180px]">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary dark:text-primary">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/15 dark:bg-primary/20">
                <Icon icon="solar:stars-minimalistic-bold-duotone" width="12" />
              </span>
              Qunvert AI
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">AI agents</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-slate-500 dark:text-white/45">
              Create focused WhatsApp agents that understand your catalog, capture orders, and hand conversations back to your team.
            </p>
          </div>
          <button
            type="button"
            onClick={openBuilder}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(59,189,181,0.30)] transition hover:bg-primary-hover"
          >
            <Icon icon="solar:add-circle-bold" width="16" />
            Create AI agent
          </button>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/70 bg-white p-3.5 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-white/40">AI agents</span>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary"><Icon icon="solar:stars-minimalistic-bold-duotone" width="14" /></span>
            </div>
            <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{agents.length}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/30">Configurations saved</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white p-3.5 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-white/40">Assigned products</span>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary"><Icon icon="solar:box-minimalistic-bold-duotone" width="14" /></span>
            </div>
            <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{configuredProducts}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/30">Across all agents</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white p-3.5 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-500 dark:text-white/40">Waiting chats</span>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary"><Icon icon="solar:chat-round-dots-bold-duotone" width="14" /></span>
            </div>
            <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{waiting}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/30">Ready for the processing phase</p>
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-3">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">Your agents</h2>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-white/40">Each agent has its own products, personality, and safeguards.</p>
          </div>

          {agents.length === 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-primary/30 bg-white px-5 py-10 text-center dark:border-primary/25 dark:bg-white/[0.035]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,189,181,0.18),transparent_45%)]" />
              <span className="relative mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary">
                <Icon icon="solar:stars-minimalistic-bold-duotone" width="24" />
              </span>
              <h3 className="relative mt-3 text-[15px] font-semibold text-slate-950 dark:text-white">Create your first AI agent</h3>
              <p className="relative mx-auto mt-1.5 max-w-md text-[13px] leading-5 text-slate-500 dark:text-white/45">
                Assign products and configure the exact way your agent should respond, follow up, capture orders, and involve your team.
              </p>
              <button type="button" onClick={openBuilder} className="relative mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-white shadow-[0_10px_28px_rgba(59,189,181,0.28)] hover:bg-primary-hover">
                <Icon icon="solar:add-circle-bold" width="16" />
                Create AI agent
              </button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
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

        {notice && <p className="mt-5 text-center text-sm text-rose-500">{notice}</p>}
      </div>
    </main>
  )
}
