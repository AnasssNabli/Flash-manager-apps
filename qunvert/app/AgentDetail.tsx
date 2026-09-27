'use client'

import { Icon } from '@iconify/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import { clampMaxResponses, hasAssignedProducts, LEAD_GENERATION_AVAILABLE, MAX_AI_REPLIES_PER_CHAT, QUNVERT_BRAND } from '@/lib/agentConfig'
import { defaultLeadForm, parseLeadForm } from '@/lib/leadForm'
import { emptyQuestionnaire, parseQuestionnaire } from '@/lib/questionnaire'
import type { Product } from '@/lib/products'
import { useBridge } from '@/lib/useBridge'
import AgentTestPreview from './AgentTestPreview'
import HoverInfo from './HoverInfo'
import LeadFormBuilder from './LeadFormBuilder'
import MediaLibrary from './MediaLibrary'
import { WaLabelFields } from './WaLabelFields'
import ChannelAssignmentModal, {
  type ChannelAssignment,
} from './ChannelAssignmentModal'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

export type AgentDetailData = {
  id: string
  name: string
  storeName: string | null
  productName: string | null
  productImage: string | null
  productJson: string | null
  policiesJson: string | null
  assignments?: Array<{
    id: string
    agentId: string
    channel: 'whatsapp' | 'instagram' | 'facebook'
    endpointId: string
    displayName: string
    detailsJson?: string | null
    details?: Record<string, unknown>
  }>
}

// WhatsApp labels card is parked for now; flip this to bring it (and its label fetch) back.
const SHOW_WA_LABELS = false

const inputClass =
  'h-10 w-full rounded-xl border border-[#e7e9ef] bg-white px-3.5 text-sm text-[#111827] outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-primary dark:focus:ring-primary/20'

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
      <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#111827] dark:text-white/85">
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
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  description?: string
  disabled?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-disabled={disabled} disabled={disabled} onClick={() => { if (!disabled) onChange(!checked) }} className={`flex w-full items-start justify-between gap-4 py-3 text-start ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <span>
        <span className="block text-sm font-medium text-slate-800 dark:text-white/80">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-4 text-slate-500 dark:text-white/40">{description}</span>}
      </span>
      <span className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-primary' : 'bg-slate-300 dark:bg-white/20'}`}>
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
    <section className="fm-card">
      <h2 className="fm-title">{title}</h2>
      <p className="fm-muted mt-1">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const DEFAULT_CONFIG: AgentConfiguration = {
  color: QUNVERT_BRAND,
  tag: 'AI agent',
  purpose: 'support',
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
  questionnaire: emptyQuestionnaire(),
  leadForm: defaultLeadForm(false),
}

export default function AgentDetail({
  agent,
  catalogProducts,
  locale = null,
  onBack,
  onSave,
  onAssignmentsChange,
}: {
  agent: AgentDetailData
  catalogProducts: Product[]
  /** FlashManager app language (`fm_locale`), stored on the agent so the AI opens in it. */
  locale?: string | null
  onBack: () => void
  onSave: (payload: Record<string, unknown>) => Promise<{ policiesJson?: string | null } | void>
  onAssignmentsChange: (assignments: ChannelAssignment[]) => void
}) {
  const { getFreshToken } = useBridge()
  const rawConfig = parseJson<Partial<AgentConfiguration>>(agent.policiesJson, {})
  const [assignments, setAssignments] = useState<ChannelAssignment[]>(() =>
    (agent.assignments || []).map((assignment) => ({
      id: assignment.id,
      agentId: assignment.agentId,
      channel: assignment.channel,
      endpointId: assignment.endpointId,
      displayName: assignment.displayName,
      details: assignment.details || parseJson<Record<string, unknown>>(assignment.detailsJson || null, {}),
    })),
  )
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [name, setName] = useState(agent.name)
  const [config, setConfig] = useState<AgentConfiguration>(() => ({
    ...DEFAULT_CONFIG,
    ...rawConfig,
    followUp: { ...DEFAULT_CONFIG.followUp, ...rawConfig.followUp },
    labels: { ...DEFAULT_CONFIG.labels, ...rawConfig.labels },
    maxResponses: clampMaxResponses(rawConfig.maxResponses),
    questionnaire: parseQuestionnaire(rawConfig.questionnaire),
    leadForm: parseLeadForm(rawConfig.leadForm, rawConfig.purpose === 'leads'),
  }))
  const [selectedProducts, setSelectedProducts] = useState<Product[]>(() =>
    parseJson<Product[]>(agent.productJson, []),
  )
  const [showCatalog, setShowCatalog] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [refining, setRefining] = useState('')
  const [waLabels, setWaLabels] = useState<{ id: string; name: string }[]>([])
  const [labelsLive, setLabelsLive] = useState(false)
  const [labelsLoading, setLabelsLoading] = useState(false)
  const [labelsError, setLabelsError] = useState('')

  // While the drawer is open it owns scrolling; hide the page scrollbar behind it.
  useEffect(() => {
    if (!settingsOpen) return
    const root = document.documentElement
    const body = document.body
    const rootOverflow = root.style.overflow
    const bodyOverflow = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = rootOverflow
      body.style.overflow = bodyOverflow
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!assignments.some((assignment) => assignment.channel === 'whatsapp') || !SHOW_WA_LABELS) {
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
  }, [assignments, getFreshToken])

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
    const assigned = hasAssignedProducts({
      allProducts: config.allProducts,
      productIds: config.allProducts ? [] : selectedProducts.map((product) => product.id),
    })
    const first = config.allProducts ? null : selectedProducts[0] || null
    try {
      const savedAgent = await onSave({
        name: name.trim(),
        prompt: config.instructions,
        language: locale || undefined,
        productScope: config.allProducts ? 'all' : 'product',
        productId: first?.id || null,
        productName: first?.title || null,
        productImage: first?.image_url || null,
        productJson: JSON.stringify(config.allProducts ? [] : selectedProducts),
        policies: {
          ...config,
          color: QUNVERT_BRAND,
          purpose: 'support',
          tag: 'Support & order changes',
          desiredStatus: config.desiredStatus,
          whatsappNumber: assignments.find((assignment) => assignment.channel === 'whatsapp')
            ? String(assignments.find((assignment) => assignment.channel === 'whatsapp')?.details.phone || '')
            : '',
          productIds: config.allProducts ? [] : selectedProducts.map((product) => product.id),
          submitVariantsForApproval: assigned && config.submitVariantsForApproval,
        },
      })
      // The server publishes the WhatsApp Flow on save; pick up its status.
      const serverConfig = savedAgent && typeof savedAgent === 'object' ? parseJson<Partial<AgentConfiguration>>(savedAgent.policiesJson || null, {}) : {}
      if (serverConfig.leadForm) {
        const serverLead = parseLeadForm(serverConfig.leadForm)
        setConfig((current) => ({
          ...current,
          leadForm: {
            ...current.leadForm,
            flowId: serverLead.flowId,
            flowHash: serverLead.flowHash,
            flowStatus: serverLead.flowStatus,
            flowError: serverLead.flowError,
          },
        }))
      }
      setSaved(true)
    } catch (reason) {
      setError((reason as Error).message || 'Could not save this agent.')
    } finally {
      setSaving(false)
    }
  }

  const removeAssignment = async (assignment: ChannelAssignment) => {
    setAssignmentBusy(true)
    setError('')
    try {
      const token = await getFreshToken()
      const response = await fetch(`${BP}/api/agents/${agent.id}/assignments/${assignment.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Could not remove this assignment.')
      const next = assignments.filter((item) => item.id !== assignment.id)
      setAssignments(next)
      onAssignmentsChange(next)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setAssignmentBusy(false)
    }
  }

  const assignmentIcon = (assignment: ChannelAssignment) => assignment.channel === 'whatsapp'
    ? 'mdi:whatsapp'
    : assignment.channel === 'instagram'
      ? 'mdi:instagram'
      : 'mdi:facebook'
  const assignmentAccent = (assignment: ChannelAssignment) => assignment.channel === 'whatsapp'
    ? 'bg-emerald-500'
    : assignment.channel === 'instagram'
      ? 'bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400'
      : 'bg-[#1877f2]'

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
          mode: 'support',
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
    <main className="min-h-screen bg-[#f4f5f8] px-4 py-5 sm:px-5 sm:py-6 dark:bg-black">
      <div className="w-full">
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
            {saved && <span className="text-xs font-semibold text-primary dark:text-primary">Saved</span>}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <Icon icon="solar:settings-linear" width="18" />
              <span className="hidden sm:inline">General settings</span>
            </button>
            <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40">
              <Icon icon={saving ? 'solar:refresh-circle-linear' : 'solar:diskette-bold'} width="17" className={saving ? 'animate-spin' : ''} />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </header>

        {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <ManageSection title="AI agent assignment" description="Choose the account where this agent answers customers.">
              {assignments.length > 0 ? (
                <div className="space-y-3">
                  {assignments.map((assignment) => {
                    const selectedPosts = Array.isArray(assignment.details.selectedPosts)
                      ? assignment.details.selectedPosts as unknown[]
                      : []
                    const destination = assignment.channel === 'whatsapp'
                      ? String(assignment.details.phone || 'WhatsApp Business')
                      : assignment.details.triggerType === 'specific_post'
                        ? `${selectedPosts.length} selected post${selectedPosts.length === 1 ? '' : 's'}`
                        : 'All posts'
                    return (
                      <div key={assignment.id} className="fm-choice fm-choice-on">
                        <div className="flex w-full items-center gap-3">
                          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-sm ${assignmentAccent(assignment)}`}>
                            <Icon icon={assignmentIcon(assignment)} width="24" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{assignment.displayName}</p>
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                Assigned
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs capitalize text-slate-500 dark:text-white/40">
                              {assignment.channel} · {destination}
                            </p>
                          </div>
                          <button type="button" onClick={() => void removeAssignment(assignment)} disabled={assignmentBusy} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-100 text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/20 dark:hover:bg-rose-500/10" aria-label={`Remove ${assignment.displayName}`}>
                            <Icon icon={assignmentBusy ? 'solar:refresh-circle-linear' : 'solar:trash-bin-trash-linear'} width="17" className={assignmentBusy ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  <button type="button" onClick={() => setAssignmentOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-white/10 dark:text-white/65">
                    <Icon icon="solar:add-circle-linear" width="18" />
                    Add assignment
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-7 text-center dark:border-white/15 dark:bg-white/[0.025]">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
                    <Icon icon="solar:link-circle-bold-duotone" width="24" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">Not assigned yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-white/40">
                    Assign WhatsApp, Instagram, or Facebook when you are ready for this agent to answer customers.
                  </p>
                  <button type="button" onClick={() => setAssignmentOpen(true)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">
                    <Icon icon="solar:link-circle-bold" width="18" />
                    Assign agent
                  </button>
                </div>
              )}
            </ManageSection>

            <ManageSection title="Identity" description="Name your agent and define its job.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Agent name">
                  <input className={inputClass} value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} />
                </Field>
                <Field label="Status">
                  <select className={inputClass} value={config.desiredStatus} onChange={(event) => patch('desiredStatus', event.target.value as 'active' | 'paused')}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </Field>
              </div>
            </ManageSection>

            <ManageSection title="Products" description="Products this agent can discuss and sell.">
              <button type="button" onClick={() => {
                if (config.allProducts) {
                  setConfig((current) => ({ ...current, allProducts: false, productIds: [], submitVariantsForApproval: false }))
                  setSelectedProducts([])
                } else {
                  setConfig((current) => ({ ...current, allProducts: true, productIds: [], submitVariantsForApproval: true }))
                  setSelectedProducts([])
                }
                setSaved(false)
              }} className={`fm-choice ${config.allProducts ? 'fm-choice-on' : ''}`}>
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${config.allProducts ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10'}`}><Icon icon="solar:widget-4-bold-duotone" width="19" /></span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white/85">All products</span>
                  <span className="block text-xs text-slate-500 dark:text-white/35">{config.allProducts ? 'Use the complete store catalog' : 'Off. Assign nothing, or pick products below.'}</span>
                </span>
                {config.allProducts && <Icon icon="solar:check-circle-bold" width="19" className="text-primary" />}
              </button>

              {!config.allProducts && (
                <div className="mt-2 space-y-2">
                  {selectedProducts.map((product) => (
                    <div key={product.id} className="fm-choice py-2.5">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-400 dark:bg-white/10"><Icon icon="solar:gallery-linear" width="18" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-white/80">{product.title}</span>
                        <span className="block text-xs text-primary">{product.price} {product.currency}</span>
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
                        <Icon icon="solar:add-circle-linear" width="17" className="text-primary" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
                <Toggle
                  checked={hasAssignedProducts({ allProducts: config.allProducts, productIds: selectedProducts.map((product) => product.id) }) && config.submitVariantsForApproval}
                  onChange={(value) => patch('submitVariantsForApproval', value)}
                  disabled={!hasAssignedProducts({ allProducts: config.allProducts, productIds: selectedProducts.map((product) => product.id) })}
                  title="Prepare product variants for Meta approval"
                  description={hasAssignedProducts({ allProducts: config.allProducts, productIds: selectedProducts.map((product) => product.id) })
                    ? 'On save, we submit the variant carousel template to Meta so the AI can send it when a customer asks for options.'
                    : 'Assign All products or at least one product to enable the Meta carousel.'}
                />
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
                    <button type="button" onClick={() => void refine()} disabled={!!refining} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50 dark:bg-primary/15 dark:text-primary">
                      <Icon icon={refining === 'instructions' ? 'solar:refresh-circle-linear' : 'solar:magic-stick-3-bold-duotone'} width="15" className={refining === 'instructions' ? 'animate-spin' : ''} />
                      Refine with AI
                    </button>
                  </div>
                  <div className="overflow-visible rounded-2xl border border-slate-200 bg-white focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20 dark:border-white/10 dark:bg-white/[0.05] dark:focus-within:ring-primary/20">
                    <textarea className="min-h-[190px] w-full resize-y rounded-t-2xl bg-transparent px-3.5 py-3 text-sm leading-5 text-slate-900 outline-none dark:text-white" value={config.instructions} onChange={(event) => patch('instructions', event.target.value)} />
                    <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5 dark:border-white/10">
                      <MediaLibrary />
                      <span className="pe-2 text-[10px] text-slate-400">Copy a media reference, then paste it above</span>
                    </div>
                  </div>
                </Field>
              </div>
            </ManageSection>

            {LEAD_GENERATION_AVAILABLE && (
            <ManageSection title="Lead agent" description="Let customers order inside WhatsApp. The agent never pushes a sale; it only collects the order when the customer asks to buy.">
              <div className="rounded-2xl border border-slate-200 px-4 dark:border-white/10">
                <Toggle
                  checked={config.leadForm.enabled}
                  onChange={(value) => patch('leadForm', { ...config.leadForm, enabled: value })}
                  title="Enable lead agent"
                  description="When a customer wants to order, the agent sends this form, saves the order in FlashManager Orders, and replies with the confirmation message."
                />
              </div>
              {config.leadForm.enabled && (
                <>
                  <LeadFormBuilder
                    value={config.leadForm}
                    onChange={(value) => patch('leadForm', value)}
                    inputClass={inputClass}
                  />
                  <div className="mt-5 space-y-4 border-t border-slate-100 pt-5 dark:border-white/10">
                    <Field label="Order confirmation message" hint="Sent to the customer right after the order is saved. Use {Full Name}, {City}, {Address}, {Province}, {Product Name}, {Quantity}, {Total Amount}, or any custom field label.">
                      <textarea className={`${inputClass} min-h-[190px] py-3 font-mono text-xs leading-5`} value={config.confirmationTemplate} onChange={(event) => patch('confirmationTemplate', event.target.value)} />
                    </Field>
                    <div className="max-w-sm">
                      <Field label="Notify new orders to" hint="Seller WhatsApp number that receives a copy of every confirmed order.">
                        <input className={inputClass} value={config.notifyOrderPhone} onChange={(event) => patch('notifyOrderPhone', event.target.value)} placeholder="+212 6 00 00 00 00" />
                      </Field>
                    </div>
                  </div>
                </>
              )}
            </ManageSection>
            )}
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

      {/* General settings: slide-over panel (anchored to the end side, so it flips in RTL). */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="General settings">
          <button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)} className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]" />
          <div className="absolute inset-y-0 end-0 flex w-full max-w-[440px] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.18)] dark:bg-[#111116]">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon icon="solar:settings-bold-duotone" width="20" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-950 dark:text-white">General settings</p>
                <p className="text-xs text-slate-500 dark:text-white/40">Reply controls, reminders, and safeguards.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/10" aria-label="Close">
                <Icon icon="solar:close-circle-linear" width="22" />
              </button>
            </div>

            <div className="min-w-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-5 py-5">
              <SettingsGroup title="Reply controls" icon="solar:tuning-2-bold-duotone">
                <div className="divide-y divide-slate-100 dark:divide-white/10">
                  <Toggle checked={config.answerOlderConversations} onChange={(value) => patch('answerOlderConversations', value)} title="Answer older conversations" description="Respond to messages from past conversations." />
                  <Toggle checked={config.respondToAudio} onChange={(value) => patch('respondToAudio', value)} title="Respond to audio messages" description="Transcribe and answer voice notes." />
                  <Toggle checked={config.answerAfterOrder} onChange={(value) => patch('answerAfterOrder', value)} title="Answer after order" description="Keep helping the customer after an order is placed." />
                  <Toggle checked={config.resumeAfterTakeover} onChange={(value) => patch('resumeAfterTakeover', value)} title="Resume AI after human takeover" description="Automatically resume after the last message in human mode." />
                </div>
                <div className="mt-3 grid gap-3">
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
                  <Field label="AI stop word" hint="When a teammate sends this word in a chat, the AI stops replying there.">
                    <input className={inputClass} value={config.stopWord} onChange={(event) => patch('stopWord', event.target.value)} />
                  </Field>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Follow-up reminders" icon="solar:alarm-bold-duotone">
                <Toggle checked={config.followUp.enabled} onChange={(value) => patch('followUp', { ...config.followUp, enabled: value })} title="Enable follow-up reminders" description="Re-engage customers who go quiet." />
                {config.followUp.enabled && (
                  <div className="mt-2 grid gap-3 grid-cols-2">
                    <Field label="Delay (hours)">
                      <input type="number" min="0" className={inputClass} value={config.followUp.hours} onChange={(event) => patch('followUp', { ...config.followUp, hours: Math.max(0, Number(event.target.value)) })} />
                    </Field>
                    <Field label="Delay (minutes)">
                      <input type="number" min="0" max="59" className={inputClass} value={config.followUp.minutes} onChange={(event) => patch('followUp', { ...config.followUp, minutes: Math.min(59, Math.max(0, Number(event.target.value))) })} />
                    </Field>
                    <div className="col-span-2">
                      <Field label="Reminder instructions">
                        <textarea className={`${inputClass} min-h-[90px] py-3`} value={config.followUp.instructions} onChange={(event) => patch('followUp', { ...config.followUp, instructions: event.target.value })} placeholder="Warmly remind the customer about the product…" />
                      </Field>
                    </div>
                  </div>
                )}
              </SettingsGroup>

              {SHOW_WA_LABELS && assignments.some((assignment) => assignment.channel === 'whatsapp') && (
                <SettingsGroup title="WhatsApp labels" icon="solar:tag-bold-duotone">
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
                </SettingsGroup>
              )}

              <SettingsGroup title="Conversation safeguards" icon="solar:shield-check-bold-duotone">
                <div className="grid gap-3">
                  <Field label="Max AI responses per chat" hint={`Hard cap is ${MAX_AI_REPLIES_PER_CHAT} so two bots cannot loop forever.`}>
                    <input type="number" min="1" max={MAX_AI_REPLIES_PER_CHAT} className={inputClass} value={config.maxResponses} onChange={(event) => patch('maxResponses', clampMaxResponses(event.target.value))} />
                  </Field>
                  <Field label="Notify human requests to" hint="Alert this number when a customer asks for a person.">
                    <input className={inputClass} value={config.notifyHumanPhone} onChange={(event) => patch('notifyHumanPhone', event.target.value)} placeholder="+212 6 00 00 00 00" />
                  </Field>
                  <Field label="Do not answer these numbers" hint="One phone number or chat ID per line.">
                    <textarea className={`${inputClass} min-h-[90px] py-3 font-mono text-xs`} value={config.ignoredNumbers} onChange={(event) => patch('ignoredNumbers', event.target.value)} placeholder={'0600000000\n+212700000000'} />
                  </Field>
                </div>
              </SettingsGroup>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 dark:border-white/10">
              <p className="text-[11px] text-slate-400 dark:text-white/35">Changes apply when you save.</p>
              <button type="button" onClick={() => { setSettingsOpen(false); void save() }} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-40">
                <Icon icon="solar:diskette-bold" width="16" />
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
      {assignmentOpen && (
        <ChannelAssignmentModal
          agentId={agent.id}
          onClose={() => setAssignmentOpen(false)}
          onAssigned={(next) => {
            const updated = [
              ...assignments.filter((assignment) =>
                !(assignment.channel === next.channel && assignment.endpointId === next.endpointId),
              ),
              next,
            ]
            setAssignments(updated)
            onAssignmentsChange(updated)
          }}
        />
      )}
    </main>
  )
}

function SettingsGroup({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <section className="fm-card">
      <div className="mb-3 flex items-center gap-2">
        <Icon icon={icon} width="18" className="text-primary" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white/90">{title}</h3>
      </div>
      {children}
    </section>
  )
}
