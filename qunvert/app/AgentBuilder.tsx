'use client'

import { Icon } from '@iconify/react'
import { useMemo, useState, type ReactNode } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import { clampMaxResponses, MAX_AI_REPLIES_PER_CHAT } from '@/lib/agentConfig'
import type { Product } from '@/lib/products'
import type { Store } from '@/lib/stores'
import HoverInfo from './HoverInfo'
import MediaLibrary from './MediaLibrary'
import { WaLabelFields } from './WaLabelFields'

export type { AgentConfiguration } from '@/lib/agentConfig'

export type AgentPayload = {
  name: string
  storeDomain: string | null
  storeName: string | null
  productScope: 'all' | 'product'
  productId: string | null
  productName: string | null
  productImage: string | null
  productJson: string
  policies: AgentConfiguration
  prompt: string
  language: string
}

const DEFAULT_INSTRUCTIONS = `You are a helpful sales assistant. Answer product questions, suggest relevant items, and help customers order.
When a customer wants to order, collect: Full name, phone number, and complete address.
Be friendly, suggest related products, and mention promotions when relevant.
Always confirm order details before finalizing.
Do not ask questions unless one required order field is missing. Never ask out-of-context or diagnostic questions.`

const DEFAULT_CONFIRMATION = `✅ Order confirmed!
Items: {Product Name} × {Quantity} = {Price}
Total: {Total Amount}

Information:
📞 Phone number: {Phone Number}
👤 Name: {Full Name}
🏙️ City: {City}
🏠 Address: {Address}

We will contact you shortly for delivery. 🚚`

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30 dark:focus:border-violet-400 dark:focus:ring-violet-500/10'

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] sm:p-6 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="mb-5 flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
          <Icon icon={icon} width="20" />
        </span>
        <div>
          <h2 className="font-semibold tracking-[-0.01em] text-slate-950 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-sm leading-5 text-slate-500 dark:text-white/45">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
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
  badge,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description?: string
  badge?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 text-start transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-white/20"
    >
      <span>
        <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white/90">
          {title}
          {badge && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
              {badge}
            </span>
          )}
        </span>
        {description && (
          <span className="mt-1 block max-w-xl text-xs leading-4 text-slate-500 dark:text-white/40">
            {description}
          </span>
        )}
      </span>
      <span
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-violet-600' : 'bg-slate-300 dark:bg-white/20'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
            checked ? 'start-6' : 'start-1'
          }`}
        />
      </span>
    </button>
  )
}

export default function AgentBuilder({
  stores,
  products,
  whatsapp,
  waLabels = [],
  loadingProducts,
  busy,
  onCancel,
  onSave,
}: {
  stores: Store[]
  products: Product[]
  whatsapp: {
    connected?: boolean
    isShared?: boolean
    tokenExpired?: boolean
    phone?: { displayPhone?: string; verifiedName?: string } | null
  }
  waLabels?: { id: string; name: string }[]
  loadingProducts: boolean
  busy: boolean
  onCancel: () => void
  onSave: (payload: AgentPayload) => Promise<void>
}) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('My AI Sales Agent')
  const [purpose, setPurpose] = useState<'leads' | 'support'>('leads')
  const [desiredStatus, setDesiredStatus] = useState<'active' | 'paused'>('active')
  const [storeId, setStoreId] = useState(stores[0]?.id || '')
  const [productSearch, setProductSearch] = useState('')
  const [allProducts, setAllProducts] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitVariants, setSubmitVariants] = useState(true)
  const [tone, setTone] = useState('friendly')
  const [autoReply, setAutoReply] = useState('')
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS)
  const [followUpEnabled] = useState(false)
  const [followUpHours] = useState(3)
  const followUpMinutes = 0
  const followUpInstructions = ''
  const [answerOlder, setAnswerOlder] = useState(true)
  const [respondAudio, setRespondAudio] = useState(false)
  const [answerAfterOrder, setAnswerAfterOrder] = useState(true)
  const [resumeTakeover, setResumeTakeover] = useState(true)
  const [resumeMinutes, setResumeMinutes] = useState(5)
  const [stopWord, setStopWord] = useState('stop')
  const [labels, setLabels] = useState({
    newCustomer: '',
    orderConfirmation: '',
    orderSummary: '',
    followUp: '',
  })
  const customLabels: { condition: string; label: string }[] = []
  const [confirmationTemplate, setConfirmationTemplate] = useState(DEFAULT_CONFIRMATION)
  const [maxResponses, setMaxResponses] = useState(MAX_AI_REPLIES_PER_CHAT)
  const [notifyHumanPhone, setNotifyHumanPhone] = useState('')
  const [ignoredNumbers, setIgnoredNumbers] = useState('')
  const [notifyOrderPhone, setNotifyOrderPhone] = useState('')

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase()
    if (!query) return products
    return products.filter((product) =>
      `${product.title} ${product.description || ''}`.toLowerCase().includes(query),
    )
  }, [productSearch, products])

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.includes(product.id)),
    [products, selectedIds],
  )
  const selectedStore = stores.find((store) => store.id === storeId) || stores[0] || null

  const toggleProduct = (id: string) => {
    setAllProducts(false)
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((productId) => productId !== id) : [...current, id],
    )
  }

  const submit = async () => {
    const first = selectedProducts[0] || null
    const configuration: AgentConfiguration = {
      color: '#6D5EF6',
      tag: purpose === 'leads' ? 'Generate leads' : 'Customer support',
      purpose,
      desiredStatus,
      whatsappNumber: whatsapp.phone?.displayPhone || '',
      allProducts,
      productIds: selectedIds,
      submitVariantsForApproval: submitVariants,
      tone,
      forbiddenContent: '',
      autoReplyOpener: autoReply,
      instructions,
      followUp: {
        enabled: followUpEnabled,
        hours: followUpHours,
        minutes: followUpMinutes,
        instructions: followUpInstructions,
      },
      answerOlderConversations: answerOlder,
      respondToAudio: respondAudio,
      answerAfterOrder,
      resumeAfterTakeover: resumeTakeover,
      resumeAfterMinutes: resumeMinutes,
      stopWord,
      labels: { ...labels, custom: customLabels },
      confirmationTemplate,
      maxResponses,
      notifyHumanPhone,
      ignoredNumbers,
      notifyOrderPhone,
    }

    await onSave({
      name: name.trim(),
      storeDomain: selectedStore?.domain || null,
      storeName: selectedStore?.name || null,
      productScope: allProducts ? 'all' : selectedProducts.length === 1 ? 'product' : 'all',
      productId: first?.id || null,
      productName: first?.title || null,
      productImage: first?.image_url || null,
      productJson: JSON.stringify(selectedProducts),
      policies: configuration,
      prompt: instructions.trim(),
      language: 'auto',
    })
  }

  const connected = whatsapp.connected === true && !whatsapp.tokenExpired
  const productsReady = purpose === 'support' || allProducts || selectedProducts.length > 0
  const valid = connected && !!name.trim() && productsReady && !!instructions.trim()
  const canContinue =
    step === 1 ? connected && !!name.trim() && productsReady :
    step === 2 ? !!instructions.trim() :
    true
  const steps = [
    { number: 1, label: 'Basics & products', icon: 'solar:box-minimalistic-bold-duotone' },
    { number: 2, label: 'Conversation', icon: 'solar:chat-round-dots-bold-duotone' },
    { number: 3, label: 'Automation', icon: 'solar:tuning-2-bold-duotone' },
    { number: 4, label: 'Orders', icon: 'solar:checklist-minimalistic-bold-duotone' },
  ]

  return (
    <div className="min-h-screen bg-[#f7f7fa] dark:bg-black">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0d0d10]/90">
        <div className="mx-auto flex max-w-[940px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5"
              aria-label="Back to agents"
            >
              <Icon icon="solar:arrow-left-linear" width="20" />
            </button>
            <div className="min-w-0">
              <p className="truncate font-semibold tracking-[-0.01em] text-slate-950 dark:text-white">Create AI agent</p>
              <p className="hidden text-xs text-slate-500 sm:block dark:text-white/40">Configure how your agent sells and supports customers.</p>
            </div>
          </div>
          <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
            Step {step} of 4
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[940px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-6 grid grid-cols-4 gap-2">
          {steps.map((item) => (
            <div key={item.number} className="min-w-0">
              <div className={`h-1.5 rounded-full transition ${step >= item.number ? 'bg-violet-600' : 'bg-slate-200 dark:bg-white/10'}`} />
              <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-semibold sm:text-xs ${step >= item.number ? 'text-violet-700 dark:text-violet-200' : 'text-slate-400 dark:text-white/25'}`}>
                <Icon icon={item.icon} width="14" className="hidden sm:block" />
                <span className="truncate">{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">{steps[step - 1].label}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-[28px] dark:text-white">
              {step === 1 && 'Choose what this agent will sell.'}
              {step === 2 && 'Shape every customer conversation.'}
              {step === 3 && 'Control handoffs and automation.'}
              {step === 4 && 'Finish order collection and safeguards.'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-white/45">
              {step === 1 && 'Set the identity, WhatsApp number, and products.'}
              {step === 2 && 'Define the voice, instructions, and follow-up behavior.'}
              {step === 3 && 'Choose when the agent replies and how labels are applied.'}
              {step === 4 && 'Configure order confirmations, notifications, and response limits.'}
            </p>
          </div>

          {step === 1 && (
            <>
          <Section icon="solar:target-bold-duotone" title="Agent purpose" description="Choose the single job this agent should focus on.">
            <div className="space-y-2.5">
              {([
                {
                  id: 'leads',
                  title: 'Generate leads',
                  description: 'Capture and qualify new contacts from WhatsApp conversations.',
                  icon: 'solar:user-plus-rounded-bold-duotone',
                },
                {
                  id: 'support',
                  title: 'Customer support',
                  description: 'Answer product questions and keep existing customers happy.',
                  icon: 'solar:help-bold-duotone',
                },
              ] as const).map((option) => {
                const selected = purpose === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setPurpose(option.id)
                      if (option.id === 'support') setAllProducts(false)
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-start transition ${
                      selected
                        ? 'border-violet-300 bg-violet-50/70 dark:border-violet-500/40 dark:bg-violet-500/10'
                        : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
                    }`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${selected ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/45'}`}>
                      <Icon icon={option.icon} width="20" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white/90">{option.title}</span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/40">{option.description}</span>
                    </span>
                    {selected && <Icon icon="solar:check-circle-bold" width="20" className="shrink-0 text-violet-600 dark:text-violet-300" />}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section icon="solar:user-id-bold-duotone" title="Identity" description="Name your agent and set its future activation status.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent name">
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Lina — Sales assistant" />
              </Field>
              <Field label="Status" hint="We’ll save this preference. Processing will be connected in the next phase.">
                <select className={inputClass} value={desiredStatus} onChange={(event) => setDesiredStatus(event.target.value as 'active' | 'paused')}>
                  <option value="active">Active when connected</option>
                  <option value="paused">Paused</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section icon="solar:shop-2-bold-duotone" title="Store & WhatsApp" description="Choose where this agent works and which number it represents.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Store">
                <select className={inputClass} value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                  {stores.length === 0 && <option value="">FlashManager catalog</option>}
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </Field>
              <Field label="Connected WhatsApp" hint="This agent automatically uses your connected WhatsApp Business number.">
                <div className={`flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2 ${
                  connected
                    ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10'
                    : 'border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10'
                }`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${connected ? 'bg-emerald-500 text-white' : 'bg-rose-100 text-rose-500 dark:bg-rose-500/20'}`}>
                    <Icon icon="logos:whatsapp-icon" width="19" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white/85">
                      {connected ? whatsapp.phone?.verifiedName || 'WhatsApp Business' : 'No WhatsApp connected'}
                    </p>
                    <p className={`truncate text-xs ${connected ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                      {connected ? whatsapp.phone?.displayPhone || 'Connected' : 'Connect a number in WhatsApp Business first'}
                    </p>
                  </div>
                </div>
              </Field>
            </div>
          </Section>

          <Section
            icon="solar:box-minimalistic-bold-duotone"
            title="Products"
            description={purpose === 'support'
              ? 'Optional. Pick products this support agent can reference. All products stays off unless you choose it.'
              : 'Assign one or more products this agent is allowed to discuss and sell.'}
          >
            <button
              type="button"
              onClick={() => {
                setAllProducts(true)
                setSelectedIds([])
              }}
              className={`mb-3 flex w-full items-center gap-3 rounded-2xl border p-4 text-start transition ${
                allProducts
                  ? 'border-violet-300 bg-violet-50/70 dark:border-violet-500/40 dark:bg-violet-500/10'
                  : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
              }`}
            >
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${allProducts ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/45'}`}>
                <Icon icon="solar:widget-4-bold-duotone" width="22" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white/90">All products</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/40">The agent can answer questions about your entire catalog.</span>
              </span>
              {allProducts && <Icon icon="solar:check-circle-bold" width="20" className="shrink-0 text-violet-600 dark:text-violet-300" />}
            </button>
            <div className="relative">
              <Icon icon="solar:magnifer-linear" width="19" className="absolute start-3.5 top-3 text-slate-400" />
              <input className={`${inputClass} ps-10`} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search your catalog…" />
            </div>
            <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pe-1">
              {loadingProducts ? (
                <div className="grid min-h-32 place-items-center text-sm text-slate-400">Loading products…</div>
              ) : filteredProducts.length === 0 ? (
                <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-white/10">No products found.</div>
              ) : (
                filteredProducts.map((product) => {
                  const selected = selectedIds.includes(product.id)
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => toggleProduct(product.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition ${
                        selected
                          ? 'border-violet-300 bg-violet-50/70 dark:border-violet-500/40 dark:bg-violet-500/10'
                          : 'border-slate-200/80 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
                      }`}
                    >
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-white/10">
                          <Icon icon="solar:gallery-linear" width="20" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-white/90">{product.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/40">{product.price} {product.currency}</span>
                      </span>
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border ${selected ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 dark:border-white/20'}`}>
                        {selected && <Icon icon="solar:check-read-linear" width="15" />}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <p className="mt-3 text-xs font-medium text-violet-600 dark:text-violet-300">{allProducts ? 'All products selected' : `${selectedIds.length} selected`}</p>
            <div className="mt-4">
              <Toggle
                checked={submitVariants}
                onChange={setSubmitVariants}
                title="Prepare product variants for Meta approval"
                badge="Recommended"
                description="Keeps selected variants ready for catalog approval so an approved product carousel can be sent when a customer asks for options."
              />
            </div>
          </Section>
            </>
          )}

          {step === 2 && (
            <>
          <Section icon="solar:chat-round-dots-bold-duotone" title="Conversation" description="Shape the tone, opener, and behavior of every reply.">
            <div className="space-y-4">
              <Field label="Tone of voice">
                <select className={inputClass} value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="concise">Concise</option>
                  <option value="sales">Sales-focused</option>
                </select>
              </Field>
              <Field label="Auto-reply opener" hint="Sent word-for-word as the reply to the customer’s first message. Leave empty to let AI answer naturally.">
                <textarea className={`${inputClass} min-h-[92px] py-3`} value={autoReply} onChange={(event) => setAutoReply(event.target.value)} placeholder="Hi 👋 How can I help you today?" />
              </Field>
              <Field label="Behavior & instructions">
                <div className="overflow-visible rounded-2xl border border-slate-200 bg-white transition focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-100 dark:border-white/10 dark:bg-white/[0.05] dark:focus-within:border-violet-400 dark:focus-within:ring-violet-500/10">
                  <textarea className="min-h-[190px] w-full resize-y rounded-t-2xl bg-transparent px-3.5 py-3 text-sm leading-5 text-slate-900 outline-none dark:text-white" value={instructions} onChange={(event) => setInstructions(event.target.value)} />
                  <div className="flex items-center justify-between border-t border-slate-100 px-2 py-1.5 dark:border-white/10">
                    <MediaLibrary />
                    <span className="pe-2 text-[10px] text-slate-400 dark:text-white/30">Paste copied {'{media:file.jpg}'} references anywhere above</span>
                  </div>
                </div>
              </Field>
            </div>
          </Section>
            </>
          )}

          {step === 3 && (
            <>
          <Section icon="solar:tuning-2-bold-duotone" title="Reply controls" description="Fine-tune when the agent replies, pauses, and resumes.">
            <div className="space-y-2.5">
              <Toggle checked={answerOlder} onChange={setAnswerOlder} title="Answer older conversations" description="Respond to messages from past conversations." />
              <Toggle checked={respondAudio} onChange={setRespondAudio} title="Respond to audio messages" description="Use AI to transcribe and respond to voice notes." />
              <Toggle checked={answerAfterOrder} onChange={setAnswerAfterOrder} title="Answer after order" description="Keep helping the customer after an order is placed." />
              <Toggle checked={resumeTakeover} onChange={setResumeTakeover} title="Resume AI after human takeover" description="Automatically resume after the last message in human mode." />
            </div>
            {resumeTakeover && (
              <div className="mt-4 max-w-xs">
                <Field
                  label="Resume after human takeover"
                  info="After a teammate replies, or after the AI hands the chat to a human, the AI stays silent. It resumes only after this many minutes have passed since the last message in that human-mode window."
                >
                  <div className="relative">
                    <input type="number" min="1" className={inputClass} value={resumeMinutes} onChange={(event) => setResumeMinutes(Math.max(1, Number(event.target.value)))} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-xs text-slate-400">min</span>
                  </div>
                </Field>
              </div>
            )}
            <div className="mt-4">
              <Field label="AI agent stop word" hint="When a teammate sends this word in a chat, the AI stops replying there.">
                <input className={inputClass} value={stopWord} onChange={(event) => setStopWord(event.target.value)} placeholder="stop" />
              </Field>
            </div>
          </Section>
          <Section icon="solar:tag-bold-duotone" title="WhatsApp labels" description="These labels are loaded from the connected WhatsApp number and applied during AI processing.">
            <WaLabelFields
              values={labels}
              options={waLabels}
              live={waLabels.length > 0}
              inputClass={inputClass}
              onChange={(key, value) => setLabels((current) => ({ ...current, [key]: value }))}
            />
          </Section>
            </>
          )}

          {step === 4 && (
            <>
          <Section icon="solar:clipboard-check-bold-duotone" title="Order confirmation" description="Set the WhatsApp message sent after an order is confirmed.">
            <Field label="Message template" hint="Use {placeholders} to insert order details.">
              <textarea className={`${inputClass} min-h-[240px] py-3 font-mono text-xs leading-5`} value={confirmationTemplate} onChange={(event) => setConfirmationTemplate(event.target.value)} />
            </Field>
          </Section>

          <Section icon="solar:shield-check-bold-duotone" title="WhatsApp safeguards" description="Set limits, escalation alerts, and numbers the agent must ignore.">
            <div className="space-y-4">
              <Field label="Max AI responses per chat" hint="The AI stops after this many replies in one chat. Hard cap is 60 so two bots cannot loop forever.">
                <input type="number" min="1" max={MAX_AI_REPLIES_PER_CHAT} className={inputClass} value={maxResponses} onChange={(event) => setMaxResponses(clampMaxResponses(event.target.value))} />
              </Field>
              <Field label="Notify the human requests to" hint="Send an alert to this number when a customer asks for a person.">
                <input className={inputClass} value={notifyHumanPhone} onChange={(event) => setNotifyHumanPhone(event.target.value)} placeholder="+212 6 00 00 00 00" />
              </Field>
              <Field label="Do NOT answer these numbers" hint="One phone number or chat ID per line. The AI ignores messages from these.">
                <textarea className={`${inputClass} min-h-[100px] py-3 font-mono text-xs`} value={ignoredNumbers} onChange={(event) => setIgnoredNumbers(event.target.value)} placeholder={'0600000000\n+212700000000\n123456789@g.us'} />
              </Field>
              <Field label="Notify order to" hint="Order confirmations are sent to this WhatsApp number.">
                <input className={inputClass} value={notifyOrderPhone} onChange={(event) => setNotifyOrderPhone(event.target.value)} placeholder="+212 6 00 00 00 00" />
              </Field>
            </div>
          </Section>
            </>
          )}

          <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_16px_45px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#17171c]/95">
            <button
              type="button"
              onClick={() => step === 1 ? onCancel() : setStep((current) => current - 1)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5"
            >
              <Icon icon="solar:arrow-left-linear" width="18" />
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((current) => current + 1)}
                disabled={!canContinue}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(109,94,246,0.25)] transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continue
                <Icon icon="solar:arrow-right-linear" width="18" />
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!valid || busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(109,94,246,0.25)] transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
                <Icon icon="solar:diskette-bold" width="18" />
                {busy ? 'Saving agent…' : 'Create AI agent'}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
