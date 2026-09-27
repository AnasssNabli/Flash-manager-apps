'use client'

import { Icon } from '@iconify/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentConfiguration } from '@/lib/agentConfig'
import { hasAssignedProducts, MAX_AI_REPLIES_PER_CHAT, QUNVERT_BRAND } from '@/lib/agentConfig'
import type { ProductBrief } from '@/lib/ai'
import { defaultLeadForm } from '@/lib/leadForm'
import { compileQuestionnairePrompt, completedAnswers, emptyQuestionnaire } from '@/lib/questionnaire'
import type { Product } from '@/lib/products'
import type { Store } from '@/lib/stores'
import { useBridge } from '@/lib/useBridge'
import HoverInfo from './HoverInfo'
import QuestionnaireChat from './QuestionnaireChat'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

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
  'h-10 w-full rounded-xl border border-[#e7e9ef] bg-white px-3.5 text-sm text-[#111827] outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30 dark:focus:border-primary dark:focus:ring-primary/20'

function toBriefs(products: Product[]): ProductBrief[] {
  return products.slice(0, 40).map((product) => ({
    title: product.title,
    price: product.price,
    currency: product.currency,
    description: product.description,
    variants: (product.variants || []).map((variant) => variant.title || '').filter(Boolean),
  }))
}

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
    <section className="fm-card">
      <div className="mb-4 flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary">
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
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description?: string
  badge?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      className={`flex w-full items-start justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 text-start transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.025] dark:hover:border-white/20 ${disabled ? 'cursor-not-allowed opacity-50 hover:border-slate-200/80 dark:hover:border-white/10' : ''}`}
    >
      <span>
        <span className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white/90">
          {title}
          {badge && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-primary">
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
          checked ? 'bg-primary' : 'bg-slate-300 dark:bg-white/20'
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
  locale = null,
  loadingProducts,
  busy,
  onCancel,
  onSave,
}: {
  stores: Store[]
  products: Product[]
  /** FlashManager app language (`fm_locale`): the AI opens conversations in it. */
  locale?: string | null
  loadingProducts: boolean
  busy: boolean
  onCancel: () => void
  onSave: (payload: AgentPayload) => Promise<void>
}) {
  const { getFreshToken } = useBridge()
  const [step, setStep] = useState(1)
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [promptError, setPromptError] = useState('')
  const [storeId, setStoreId] = useState(stores[0]?.id || '')
  const [productSearch, setProductSearch] = useState('')
  const [allProducts, setAllProducts] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitVariants, setSubmitVariants] = useState(true)
  const tone = 'friendly'
  const [questionnaire, setQuestionnaire] = useState(emptyQuestionnaire)
  const [, setQuestionnaireReady] = useState(false)

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
  const catalogAssigned = hasAssignedProducts({ allProducts, productIds: selectedIds })

  useEffect(() => {
    if (!catalogAssigned && submitVariants) setSubmitVariants(false)
  }, [catalogAssigned, submitVariants])

  const toggleProduct = (id: string) => {
    setAllProducts(false)
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((productId) => productId !== id) : [...current, id],
    )
  }

  const agentProducts = allProducts ? products : selectedProducts
  const productBriefs = useMemo(() => toBriefs(agentProducts), [agentProducts])
  const agentName = `${selectedStore?.name || 'Store'} AI agent`.trim()

  const builtPrompt = compileQuestionnairePrompt({
    tone,
    storeName: selectedStore?.name || null,
    entries: completedAnswers(questionnaire),
  })

  const generatePrompt = async () => {
    const token = await getFreshToken()
    if (!token) throw new Error('no_token')
    const response = await fetch(`${BP}/api/agents/prompt`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        buildFromQuestionnaire: true,
        tone,
        storeName: selectedStore?.name || null,
        products: productBriefs,
        language: locale,
        common: questionnaire.common,
        interview: questionnaire.interview,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not generate the prompt.')
    return String(data.prompt || '').trim()
  }

  const submit = async () => {
    setGeneratingPrompt(true)
    setPromptError('')
    try {
    let promptText = ''
    try {
      promptText = await generatePrompt()
    } catch (reason) {
      promptText = builtPrompt
      if (!promptText) {
        setPromptError((reason as Error).message || 'Could not generate the prompt.')
        return
      }
    }
    const first = selectedProducts[0] || null
    const configuration: AgentConfiguration = {
      color: QUNVERT_BRAND,
      // New-order capture is parked; the agent supports customers and existing orders.
      tag: 'Support & order changes',
      purpose: 'support',
      desiredStatus: 'active',
      whatsappNumber: '',
      allProducts,
      productIds: allProducts ? [] : selectedIds,
      submitVariantsForApproval: catalogAssigned && submitVariants,
      tone,
      forbiddenContent: '',
      autoReplyOpener: '',
      instructions: promptText,
      questionnaire,
      leadForm: defaultLeadForm(false),
      // Reply controls, labels, and safeguards live in Manage → Settings; sensible defaults here.
      followUp: { enabled: false, hours: 3, minutes: 0, instructions: '' },
      answerOlderConversations: true,
      respondToAudio: false,
      answerAfterOrder: true,
      resumeAfterTakeover: true,
      resumeAfterMinutes: 5,
      stopWord: 'stop',
      labels: { newCustomer: '', orderConfirmation: '', orderSummary: '', followUp: '', custom: [] },
      confirmationTemplate: DEFAULT_CONFIRMATION,
      maxResponses: MAX_AI_REPLIES_PER_CHAT,
      notifyHumanPhone: '',
      ignoredNumbers: '',
      notifyOrderPhone: '',
    }

    await onSave({
      name: agentName,
      storeDomain: selectedStore?.domain || null,
      storeName: selectedStore?.name || null,
      productScope: allProducts ? 'all' : 'product',
      productId: first?.id || null,
      productName: first?.title || null,
      productImage: first?.image_url || null,
      productJson: JSON.stringify(selectedProducts),
      policies: configuration,
      prompt: promptText,
      language: locale || 'auto',
    })
    } finally {
      setGeneratingPrompt(false)
    }
  }

  const valid = true
  const canContinue = true
  const steps = [
    { number: 1, label: 'Store & products', icon: 'solar:box-minimalistic-bold-duotone' },
    { number: 2, label: 'Product knowledge', icon: 'solar:book-bookmark-bold-duotone' },
  ]
  const LAST_STEP = steps.length

  return (
    <div className="min-h-screen bg-[#f4f5f8] dark:bg-black">
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
              <p className="hidden text-xs text-slate-500 sm:block dark:text-white/40">Two steps: choose products, then teach the agent.</p>
            </div>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary dark:bg-primary/15 dark:text-primary">
            Step {step} of {LAST_STEP}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[940px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="mb-6 grid grid-cols-2 gap-2">
          {steps.map((item) => (
            <div key={item.number} className="min-w-0">
              <div className={`h-1.5 rounded-full transition ${step >= item.number ? 'bg-primary' : 'bg-slate-200 dark:bg-white/10'}`} />
              <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-semibold sm:text-xs ${step >= item.number ? 'text-primary dark:text-primary' : 'text-slate-400 dark:text-white/25'}`}>
                <Icon icon={item.icon} width="14" className="hidden sm:block" />
                <span className="truncate">{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary dark:text-primary">{steps[step - 1].label}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-[28px] dark:text-white">
              {step === 1 && 'Pick the store and products.'}
              {step === 2 && 'Build your agent’s product knowledge.'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-white/45">
              {step === 1 && 'Choose the store and products this agent should understand. You can assign a channel after creation.'}
              {step === 2 && 'Your AI studies the selected products and asks what real customers would. Your answers become its knowledge, then it writes its own instructions when you click Create. Orders and settings are configured on the Manage page.'}
            </p>
          </div>

          {step === 1 && (
            <>
          <Section icon="solar:shop-2-bold-duotone" title="Store" description="Choose the catalog this agent should use.">
            <div className="max-w-md">
              <Field label="Store">
                <select className={inputClass} value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                  {stores.length === 0 && <option value="">FlashManager catalog</option>}
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section
            icon="solar:box-minimalistic-bold-duotone"
            title="Products"
            description="The agent answers about these products and, in the next step, asks you questions about them like a customer would."
          >
            <button
              type="button"
              onClick={() => {
                if (allProducts) {
                  setAllProducts(false)
                  setSelectedIds([])
                  setSubmitVariants(false)
                } else {
                  setAllProducts(true)
                  setSelectedIds([])
                  setSubmitVariants(true)
                }
              }}
              className={`fm-choice mb-3 ${allProducts ? 'fm-choice-on' : ''}`}
            >
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${allProducts ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/45'}`}>
                <Icon icon="solar:widget-4-bold-duotone" width="22" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white/90">All products</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/40">
                  {allProducts
                    ? 'The agent can answer questions about your entire catalog.'
                    : 'Off. No catalog is assigned unless you pick products below.'}
                </span>
              </span>
              {allProducts && <Icon icon="solar:check-circle-bold" width="20" className="shrink-0 text-primary dark:text-primary" />}
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
                      className={`fm-choice py-3 ${selected ? 'fm-choice-on' : ''}`}
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
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-white' : 'border-[#d5d8e0] dark:border-white/20'}`}>
                        {selected && <Icon icon="solar:check-read-linear" width="15" />}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <p className="mt-3 text-xs font-medium text-primary dark:text-primary">{allProducts ? 'All products selected' : selectedIds.length ? `${selectedIds.length} selected` : 'No products assigned'}</p>
            <div className="mt-4">
              <Toggle
                checked={catalogAssigned && submitVariants}
                onChange={setSubmitVariants}
                disabled={!catalogAssigned}
                title="Prepare product variants for Meta approval"
                badge="Recommended"
                description={catalogAssigned
                  ? 'On save, we submit the variant carousel template to Meta so the AI can send it when a customer asks for options.'
                  : 'Assign All products or at least one product to enable the Meta carousel. With no products, this stays off.'}
              />
            </div>
          </Section>
            </>
          )}

          {step === 2 && (
            <QuestionnaireChat
              storeName={selectedStore?.name || null}
              products={productBriefs}
              language={locale}
              value={questionnaire}
              onChange={setQuestionnaire}
              onReady={setQuestionnaireReady}
              onSkipStep={() => void submit()}
              busy={busy || generatingPrompt}
            />
          )}

          {promptError && <p className="text-sm text-rose-500">{promptError}</p>}

          <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-2xl border border-[#e7e9ef] bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[#17171c]">
            <button
              type="button"
              onClick={() => step === 1 ? onCancel() : setStep((current) => current - 1)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/5"
            >
              <Icon icon="solar:arrow-left-linear" width="18" />
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < LAST_STEP ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep((current) => current + 1)}
                  disabled={!canContinue}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                  <Icon icon="solar:arrow-right-linear" width="18" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={submit} disabled={!valid || busy || generatingPrompt} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
                <Icon icon={generatingPrompt ? 'solar:refresh-circle-linear' : 'solar:diskette-bold'} width="18" className={generatingPrompt ? 'animate-spin' : ''} />
                {generatingPrompt ? 'Building prompt…' : busy ? 'Saving agent…' : 'Create AI agent'}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
