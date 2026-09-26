import { defaultLeadForm, parseLeadForm, type LeadFormConfig } from './leadForm'
import { emptyQuestionnaire, parseQuestionnaire, type QuestionnaireState } from './questionnaire'

/** Legacy. Agents are unified; ordering is controlled by `leadForm.enabled`. */
export type AgentPurpose = 'leads' | 'support'

export const QUNVERT_BRAND = '#3BBDB5'

export type AgentConfiguration = {
  color: string
  tag: string
  purpose: AgentPurpose
  desiredStatus: 'active' | 'paused'
  whatsappNumber: string
  allProducts: boolean
  productIds: string[]
  submitVariantsForApproval: boolean
  tone: string
  forbiddenContent: string
  autoReplyOpener: string
  instructions: string
  followUp: {
    enabled: boolean
    hours: number
    minutes: number
    instructions: string
  }
  answerOlderConversations: boolean
  respondToAudio: boolean
  answerAfterOrder: boolean
  resumeAfterTakeover: boolean
  resumeAfterMinutes: number
  stopWord: string
  labels: {
    newCustomer: string
    orderConfirmation: string
    orderSummary: string
    followUp: string
    custom: { condition: string; label: string }[]
  }
  confirmationTemplate: string
  maxResponses: number
  notifyHumanPhone: string
  ignoredNumbers: string
  notifyOrderPhone: string
  questionnaire: QuestionnaireState
  leadForm: LeadFormConfig
}

export const DEFAULT_CONFIRMATION_TEMPLATE = `✅ Order Confirmed!
Items: {Product Name} x {Quantity} = {Price} MAD
Total: {Total Amount} MAD
Information:
📞 Phone Number: {PHONE NUMBER}
👤 Name: {FULL NAME}
🏙️ City: {CITY}
🏠 Address: {ADDRESS}
We will contact you shortly for delivery. 🚚`

export const DEFAULT_AGENT_CONFIG: AgentConfiguration = {
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
  followUp: {
    enabled: false,
    hours: 3,
    minutes: 0,
    instructions: '',
  },
  answerOlderConversations: true,
  respondToAudio: false,
  answerAfterOrder: true,
  resumeAfterTakeover: true,
  resumeAfterMinutes: 5,
  stopWord: '',
  labels: {
    newCustomer: '',
    orderConfirmation: '',
    orderSummary: '',
    followUp: '',
    custom: [],
  },
  confirmationTemplate: DEFAULT_CONFIRMATION_TEMPLATE,
  maxResponses: 60,
  notifyHumanPhone: '',
  ignoredNumbers: '',
  notifyOrderPhone: '',
  questionnaire: emptyQuestionnaire(),
  leadForm: defaultLeadForm(false),
}

export const MAX_AI_REPLIES_PER_CHAT = 60
/** Parked product feature. Saved form settings stay intact for later reactivation. */
export const LEAD_GENERATION_AVAILABLE = false

/** Single source of truth: may this agent take orders? */
export function leadAgentEnabled(config: Pick<AgentConfiguration, 'leadForm'>): boolean {
  return LEAD_GENERATION_AVAILABLE && !!config.leadForm?.enabled && config.leadForm.fields.length > 0
}

export function clampMaxResponses(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return MAX_AI_REPLIES_PER_CHAT
  return Math.min(MAX_AI_REPLIES_PER_CHAT, Math.max(1, Math.floor(n)))
}

export function parseAgentConfig(value: string | object | null | undefined): AgentConfiguration {
  let parsed: Partial<AgentConfiguration> = {}
  try {
    parsed = !value
      ? {}
      : typeof value === 'string'
        ? JSON.parse(value)
        : Array.isArray(value)
          ? {}
          : value as Partial<AgentConfiguration>
  } catch {
    parsed = {}
  }
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...parsed,
    productIds: Array.isArray(parsed.productIds) ? parsed.productIds.map(String) : [],
    followUp: {
      ...DEFAULT_AGENT_CONFIG.followUp,
      ...(parsed.followUp || {}),
    },
    labels: {
      ...DEFAULT_AGENT_CONFIG.labels,
      ...(parsed.labels || {}),
      custom: Array.isArray(parsed.labels?.custom)
        ? parsed.labels.custom
            .map((item) => ({
              condition: String(item?.condition || '').trim(),
              label: String(item?.label || '').trim(),
            }))
            .filter((item) => item.condition && item.label)
        : [],
    },
    maxResponses: clampMaxResponses(parsed.maxResponses),
    questionnaire: parseQuestionnaire(parsed.questionnaire),
    // Agents created before the lead-form setting existed: "leads" purpose means ordering was on.
    leadForm: parseLeadForm((parsed as Record<string, unknown>).leadForm, parsed.purpose === 'leads'),
  }
}

export function normalizePhone(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '')
}

export function comparablePhone(value: string | null | undefined): string {
  const digits = normalizePhone(value)
  return digits.length >= 9 ? digits.slice(-9) : digits
}

export function blockedPhone(config: AgentConfiguration, phone: string): boolean {
  const candidate = comparablePhone(phone)
  if (!candidate) return false
  return config.ignoredNumbers
    .split(/\r?\n|,/)
    .map(comparablePhone)
    .filter(Boolean)
    .some((blocked) => blocked === candidate)
}

export function hasAssignedProducts(config: Pick<AgentConfiguration, 'allProducts' | 'productIds'>): boolean {
  return config.allProducts || config.productIds.length > 0
}

export function shouldSubmitVariantCarousel(config: AgentConfiguration): boolean {
  return config.submitVariantsForApproval && hasAssignedProducts(config)
}

export function normalizedStopWord(value: string | null | undefined): string {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
}
