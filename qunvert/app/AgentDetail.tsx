'use client'

import { Icon } from '@iconify/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import { clampMaxResponses, MAX_AI_REPLIES_PER_CHAT } from '@/lib/agentConfig'
import type { Product } from '@/lib/products'
import { useBridge } from '@/lib/useBridge'
import AgentTestPreview from './AgentTestPreview'
import HoverInfo from './HoverInfo'
import MediaLibrary from './MediaLibrary'
import { WaLabelFields } from './WaLabelFields'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

export type AgentDetailData = {
  id: string
  name: string
  storeName: string | null
  productName: string | null
  productImage: string | null
  productJson: string | null
  policiesJson: string | null
}

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-500/10'

function parseJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function Field({
  label,
  hint,
  info,
  children,
}: {
  label: string
  hint?: string
  info?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-white/85">
        {label}
        {info && <HoverInfo text={info} />}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-4 text-slate-500 dark:text-white/40">{hint}</span>}
    </label>
  )
}

function Toggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  description?: string
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-4 py-3 text-start">
      <span>
        <span className="block text-sm font-medium text-slate-800 dark:text-white/80">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-4 text-slate-500 dark:text-white/40">{description}</span>}
      </span>
      <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-violet-600' : 'bg-slate-300 dark:bg-white/20'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'start-6' : 'start-1'}`} />
      </span>
    </button>
  )
}

function ManageSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 border-b border-slate-200 py-7 last:border-0 dark:border-white/10 md:grid-cols-[170px_minmax(0,1fr)]">
      <div>
        <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-white/40">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}

const DEFAULT_CONFIG: AgentConfiguration = {
  color: '#6D5EF6',
  tag: 'Sales agent',
  purpose: 'leads',
  desiredStatus: 'active',
  whatsappNumber: '',
  allProducts: true,
  productIds: [],
  submitVariantsForApproval: true,
  tone: 'friendly',
  forbiddenContent: '',
  autoReplyOpener: '',
  instructions: '',
  followUp: { enabled: false, hours: 3, minutes: 0, instructions: '' },
  answerOlderConversations: true,
  respondToAudio: false,
  answerAfterOrder: true,
  resumeAfterTakeover: true,
  resumeAfterMinutes: 5,
  stopWord: 'stop',
  labels: {
    newCustomer: '',
    orderConfirmation: '',
    orderSummary: '',
    followUp: '',
    custom: [],
  },
  confirmationTemplate: '',
  maxResponses: MAX_AI_REPLIES_PER_CHAT,
  notifyHumanPhone: '',
  ignoredNumbers: '',
  notifyOrderPhone: '',
}

export default function AgentDetail({
  agent,
  catalogProducts,
  whatsapp,
  onBack,
  onSave,
}: {
  agent: AgentDetailData
  catalogProducts: Product[]
  whatsapp: {
    connected?: boolean
    tokenExpired?: boolean
    phone?: { displayPhone?: string; verifiedName?: string } | null
  }
  onBack: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const { getFreshToken } = useBridge()
  const rawConfig = parseJson<Partial<AgentConfiguration>>(agent.policiesJson, {})
  const connected = whatsapp.connected === true && !whatsapp.tokenExpired
  const [name, setName] = useState(agent.name)
  const [config, setConfig] = useState<AgentConfiguration>(() => ({
    ...DEFAULT_CONFIG,
    ...rawConfig,
    followUp: { ...DEFAULT_CONFIG.followUp, ...rawConfig.followUp },
    labels: { ...DEFAULT_CONFIG.labels, ...rawConfig.labels },
    maxResponses: clampMaxResponses(rawConfig.maxResponses),
  }))
  const [selectedProducts, setSelectedProducts] = useState<Product[]>(() =>
    parseJson<Product[]>(agent.productJson, []),
  )
  const [showCatalog, setShowCatalog] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [refining, setRefining] = useState('')
  const [waLabels, setWaLabels] = useState<{ id: string; name: string }[]>([])
  const [labelsLive, setLabelsLive] = useState(false)
  const [labelsLoading, setLabelsLoading] = useState(false)
  const [labelsError, setLabelsError] = useState('')

  useEffect(() => {
    if (!connected) {
      setWaLabels([])
      setLabelsLive(false)
      setLabelsError('')
      return
    }
    let cancelled = false
    const load = async () => {
      setLabelsLoading(true)
      setLabelsError('')
      try {
        const token = await getFreshToken()
        const response = await fetch(`${BP}/api/whatsapp-labels`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Could not load WhatsApp labels.')
        if (!cancelled) {
          setWaLabels(Array.isArray(data.labels) ? data.labels : [])
          setLabelsLive(data.live === true)
        }
      } catch (reason) {
        if (!cancelled) setLabelsError((reason as Error).message)
      } finally {
        if (!cancelled) setLabelsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [connected, getFreshToken])

  const availableProducts = useMemo(() => {
    const selected = new Set(selectedProducts.map((product) => product.id))
    const query = search.trim().toLowerCase()
    return catalogProducts.filter((product) =>
      !selected.has(product.id) &&
      (!query || `${product.title} ${product.description || ''}`.toLowerCase().includes(query)),
    )
  }, [catalogProducts, search, selectedProducts])

  const patch = <K extends keyof AgentConfiguration>(key: K, value: AgentConfiguration[K]) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const addProduct = (product: Product) => {
    setSelectedProducts((current) => [...current, product])
    setConfig((current) => ({
      ...current,
      allProducts: false,
      productIds: [...current.productIds.filter((id) => id !== product.id), product.id],
    }))
    setSaved(false)
  }

  const removeProduct = (id: string) => {
    setSelectedProducts((current) => current.filter((product) => product.id !== id))
    setConfig((current) => ({ ...current, productIds: current.productIds.filter((productId) => productId !== id) }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    const first = config.allProducts ? null : selectedProducts[0] || null
    try {
      await onSave({
        name: name.trim(),
        prompt: config.instructions,
        productScope: config.allProducts ? 'all' : selectedProducts.length === 1 ? 'product' : 'all',
        productId: first?.id || null,
        productName: first?.title || null,
        productImage: first?.image_url || null,
        productJson: JSON.stringify(config.allProducts ? [] : selectedProducts),
        policies: {
          ...config,
          desiredStatus: connected ? config.desiredStatus : 'paused',
          whatsappNumber: whatsapp.phone?.displayPhone || '',
          productIds: config.allProducts ? [] : selectedProducts.map((product) => product.id),
        },
      })
      setSaved(true)
    } catch (reason) {
      setError((reason as Error).message === 'whatsapp_disconnected'
        ? 'Connect WhatsApp before activating this agent.'
        : (reason as Error).message || 'Could not save this agent.')
    } finally {
      setSaving(false)
    }
  }

  const refine = async () => {
    setRefining('instructions')
    setError('')
    try {
      const token = await getFreshToken()
      const response = await fetch(`${BP}/api/agents/refine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          field: 'instructions',
          mode: config.purpose,
          currentText: config.instructions,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not refine this prompt.')
      patch('instructions', String(data.text || ''))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setRefining('')
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fa] px-4 py-5 sm:px-6 sm:py-8 dark:bg-black">
      <div className="mx-auto max-w-[1220px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-white/60" aria-label="Back to agents">
              <Icon icon="solar:arrow-left-linear" width="20" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.025em] text-slate-950 dark:text-white">{name || 'AI agent'}</h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/40">Manage AI agent</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">Saved</span>}
            <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(109,94,246,0.25)] hover:bg-violet-700 disabled:opacity-40">
              <Icon icon={saving ? 'solar:refresh-circle-linear' : 'solar:diskette-bold'} width="17" className={saving ? 'animate-spin' : ''} />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </header>

        {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-[24px] border border-slate-200/80 bg-white px-5 sm:px-7 dark:border-white/10 dark:bg-white/[0.035]">
            <ManageSection title="Identity" description="Name your agent and define its job.">
              <div className={`mb-4 flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
                connected
                  ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10'
                  : 'border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10'
              }`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${connected ? 'bg-emerald-500 text-white' : 'bg-rose-100 text-rose-500 dark:bg-rose-500/20'}`}>
                  <Icon icon="logos:whatsapp-icon" width="20" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white/85">
                    {connected ? whatsapp.phone?.verifiedName || 'WhatsApp Business' : 'No WhatsApp connected'}
                  </p>
                  <p className={`truncate text-xs ${connected ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                    {connected ? whatsapp.phone?.displayPhone || 'Connected' : 'Agent remains paused until a number is connected'}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Agent name">
                  <input className={inputClass} value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} />
                </Field>
                <Field label="Status">
                  <select className={inputClass} value={config.desiredStatus} onChange={(event) => patch('desiredStatus', event.target.value as 'active' | 'paused')}>
                    <option value="active" disabled={!connected}>Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </Field>
              </div>
              <div className="mt-4">
                <span className="mb-2 block text-sm font-medium text-slate-800 dark:text-white/85">Agent purpose</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['leads', 'Generate leads', 'solar:user-plus-rounded-bold-duotone'],
                    ['support', 'Customer support', 'solar:help-bold-duotone'],
                  ] as const).map(([id, label, icon]) => (
                    <button key={id} type="button" onClick={() => {
                      setConfig((current) => ({
                        ...current,
                        purpose: id,
                        allProducts: id === 'support' ? false : current.allProducts,
                      }))
                      setSaved(false)
                    }} className={`flex items-center gap-2.5 rounded-xl border p-3 text-start text-sm font-medium ${config.purpose === id ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200' : 'border-slate-200 text-slate-700 dark:border-white/10 dark:text-white/60'}`}>
                      <Icon icon={icon} width="19" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </ManageSection>

            <ManageSection title="Products" description="Products this agent can discuss and sell.">
              <button type="button" onClick={() => { patch('allProducts', true); setSelectedProducts([]) }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-start ${config.allProducts ? 'border-violet-300 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10' : 'border-slate-200 dark:border-white/10'}`}>
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${config.allProducts ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10'}`}><Icon icon="solar:widget-4-bold-duotone" width="19" /></span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white/85">All products</span>
                  <span className="block text-xs text-slate-500 dark:text-white/35">Use the complete store catalog</span>
                </span>
                {config.allProducts && <Icon icon="solar:check-circle-bold" width="19" className="text-violet-600" />}
              </button>

              {!config.allProducts && (
                <div className="mt-2 space-y-2">
                  {selectedProducts.map((product) => (
                    <div key={product.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-white/10">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-400 dark:bg-white/10"><Icon icon="solar:gallery-linear" width="18" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-white/80">{product.title}</span>
                        <span className="block text-xs text-emerald-600">{product.price} {product.currency}</span>
                      </span>
                      <button type="button" onClick={() => removeProduct(product.id)} className="grid h-8 w-8 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" aria-label="Remove product">
                        <Icon icon="solar:trash-bin-trash-linear" width="17" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <button type="button" onClick={() => { setShowCatalog((current) => !current); patch('allProducts', false) }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-white/65 dark:hover:bg-white/5">
                  <Icon icon="solar:add-circle-linear" width="18" />
                  Add product
                </button>
              </div>

              {showCatalog && (
                <div className="mt-3 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.04]">
                  <input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search catalog…" />
                  <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                    {availableProducts.map((product) => (
                      <button key={product.id} type="button" onClick={() => addProduct(product)} className="flex w-full items-center gap-2 rounded-xl p-2 text-start hover:bg-white dark:hover:bg-white/5">
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-white/65">{product.title}</span>
                        <Icon icon="solar:add-circle-linear" width="17" className="text-violet-600" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
                <Toggle checked={config.submitVariantsForApproval} onChange={(value) => patch('submitVariantsForApproval', value)} title="Prepare product variants for Meta approval" />
              </div>
            </ManageSection>

            <ManageSection title="Conversation" description="Tone, opener, and AI behavior.">
              <div className="space-y-4">
                <Field label="Tone of voice">
                  <select className={inputClass} value={config.tone} onChange={(event) => patch('tone', event.target.value)}>
                    <option value="friendly">Friendly</option>
                    <option value="professional">Professional</option>
                    <option value="concise">Concise</option>
                    <option value="sales">Sales-focused</option>
                  </select>
                </Field>
                <Field label="Auto-reply opener">
                  <textarea className={`${inputClass} min-h-[88px] py-3`} value={config.autoReplyOpener} onChange={(event) => patch('autoReplyOpener', event.target.value)} placeholder="Hi 👋 How can I help you today?" />
                </Field>
                <Field label="Behavior & instructions">
                  <div className="mb-1.5 flex justify-end">
                    <button type="button" onClick={() => void refine()} disabled={!!refining} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:bg-violet-500/10 dark:text-violet-200">
                      <Icon icon={refining === 'instructions' ? 'solar:refresh-circle-linear' : 'solar:magic-stick-3-bold-duotone'} width="15" className={refining === 'instructions' ? 'animate-spin' : ''} />
                      Refine with AI
                    </button>
                  </div>
                  <div className="overflow-visible rounded-2xl border border-slate-200 bg-white focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-100 dark:border-white/10 dark:bg-white/[0.05] dark:focus-within:ring-violet-500/10">
                    <textarea className="min-h-[190px] w-full resize-y rounded-t-2xl bg-transparent px-3.5 py-3 text-sm leading-5 text-slate-900 outline-none dark:text-white" value={config.instructions} onChange={(event) => patch('instructions', event.target.value)} />
                    <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5 dark:border-white/10">
                      <MediaLibrary />
                      <span className="pe-2 text-[10px] text-slate-400">Copy a media reference, then paste it above</span>
                    </div>
                  </div>
                </Field>
              </div>
            </ManageSection>

            <ManageSection title="Follow-up reminders" description="Re-engage customers who go quiet.">
              <Toggle checked={config.followUp.enabled} onChange={(value) => patch('followUp', { ...config.followUp, enabled: value })} title="Enable follow-up reminders" />
              {config.followUp.enabled && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field label="Delay (hours)">
                    <input type="number" min="0" className={inputClass} value={config.followUp.hours} onChange={(event) => patch('followUp', { ...config.followUp, hours: Math.max(0, Number(event.target.value)) })} />
                  </Field>
                  <Field label="Delay (minutes)">
                    <input type="number" min="0" max="59" className={inputClass} value={config.followUp.minutes} onChange={(event) => patch('followUp', { ...config.followUp, minutes: Math.min(59, Math.max(0, Number(event.target.value))) })} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Reminder instructions">
                      <textarea className={`${inputClass} min-h-[100px] py-3`} value={config.followUp.instructions} onChange={(event) => patch('followUp', { ...config.followUp, instructions: event.target.value })} placeholder="Warmly remind the customer about the product…" />
                    </Field>
                  </div>
                </div>
              )}
            </ManageSection>

            <ManageSection title="Reply controls" description="Choose when AI responds and hands over.">
              <div className="divide-y divide-slate-100 dark:divide-white/10">
                <Toggle checked={config.answerOlderConversations} onChange={(value) => patch('answerOlderConversations', value)} title="Answer older conversations" />
                <Toggle checked={config.respondToAudio} onChange={(value) => patch('respondToAudio', value)} title="Respond to audio messages" />
                <Toggle checked={config.answerAfterOrder} onChange={(value) => patch('answerAfterOrder', value)} title="Answer after order" />
                <Toggle checked={config.resumeAfterTakeover} onChange={(value) => patch('resumeAfterTakeover', value)} title="Resume AI after human takeover" />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {config.resumeAfterTakeover && (
                  <Field
                    label="Resume after human takeover"
                    info="After a teammate replies, or after the AI hands the chat to a human, the AI stays silent. It resumes only after this many minutes have passed since the last message in that human-mode window."
                  >
                    <div className="relative">
                      <input type="number" min="1" className={inputClass} value={config.resumeAfterMinutes} onChange={(event) => patch('resumeAfterMinutes', Math.max(1, Number(event.target.value)))} />
                      <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-xs text-slate-400">min</span>
                    </div>
                  </Field>
                )}
                <Field label="AI stop word">
                  <input className={inputClass} value={config.stopWord} onChange={(event) => patch('stopWord', event.target.value)} />
                </Field>
              </div>
            </ManageSection>

            {connected && (
            <ManageSection title="WhatsApp labels" description="Choose labels from the connected WhatsApp number.">
              <WaLabelFields
                values={{
                  newCustomer: config.labels.newCustomer,
                  orderConfirmation: config.labels.orderConfirmation,
                  orderSummary: config.labels.orderSummary,
                  followUp: config.labels.followUp,
                }}
                options={waLabels}
                live={labelsLive}
                loading={labelsLoading}
                error={labelsError}
                inputClass={inputClass}
                onChange={(key, value) => patch('labels', { ...config.labels, [key]: value })}
              />
            </ManageSection>
            )}

            <ManageSection title="Orders & safeguards" description="Confirmation, alerts, and response limits.">
              <div className="space-y-4">
                <Field label="Order confirmation template">
                  <textarea className={`${inputClass} min-h-[210px] py-3 font-mono text-xs leading-5`} value={config.confirmationTemplate} onChange={(event) => patch('confirmationTemplate', event.target.value)} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Max AI responses per chat">
                    <input type="number" min="1" max={MAX_AI_REPLIES_PER_CHAT} className={inputClass} value={config.maxResponses} onChange={(event) => patch('maxResponses', clampMaxResponses(event.target.value))} />
                  </Field>
                  <Field label="Notify human requests to">
                    <input className={inputClass} value={config.notifyHumanPhone} onChange={(event) => patch('notifyHumanPhone', event.target.value)} placeholder="+212 6 00 00 00 00" />
                  </Field>
                  <Field label="Notify orders to">
                    <input className={inputClass} value={config.notifyOrderPhone} onChange={(event) => patch('notifyOrderPhone', event.target.value)} placeholder="+212 6 00 00 00 00" />
                  </Field>
                  <Field label="Do not answer these numbers">
                    <textarea className={`${inputClass} min-h-[90px] py-3`} value={config.ignoredNumbers} onChange={(event) => patch('ignoredNumbers', event.target.value)} />
                  </Field>
                </div>
              </div>
            </ManageSection>
          </div>

          <aside className="self-start pt-2 lg:sticky lg:top-6 lg:pt-7">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/30">Live preview</p>
            <AgentTestPreview
              agentName={name}
              agentId={agent.id}
              config={config}
              products={config.allProducts ? catalogProducts : selectedProducts}
            />
          </aside>
        </div>
      </div>
    </main>
  )
}
