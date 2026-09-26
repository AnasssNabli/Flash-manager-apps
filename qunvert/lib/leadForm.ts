/**
 * Lead agent order form.
 *
 * The seller composes the form on the Manage page (drag & drop). The same
 * definition drives three things:
 *  - the WhatsApp Flow JSON we publish through the FlashManager gateway,
 *  - the order_data schema / required fields the AI collects in chat when a
 *    Flow cannot be sent,
 *  - the mapping into a FlashManager order (`/v1/orders`).
 */

export type LeadFieldType = 'text' | 'phone' | 'textarea'

export type LeadField = {
  key: string
  label: string
  type: LeadFieldType
  required: boolean
  builtin: boolean
}

export type LeadFlowStatus = 'none' | 'published' | 'unavailable' | 'error'

export type LeadFormConfig = {
  enabled: boolean
  fields: LeadField[]
  cta: string
  flowId: string | null
  flowHash: string | null
  flowStatus: LeadFlowStatus
  flowError: string | null
}

export const LEAD_FLOW_SCREEN = 'ORDER'
export const LEAD_FLOW_VERSION = '7.1'

export const BUILTIN_LEAD_FIELDS: LeadField[] = [
  { key: 'customer_name', label: 'Full name', type: 'text', required: true, builtin: true },
  { key: 'customer_phone', label: 'Phone number', type: 'phone', required: false, builtin: true },
  { key: 'customer_address', label: 'Address', type: 'textarea', required: true, builtin: true },
  { key: 'customer_city', label: 'City', type: 'text', required: true, builtin: true },
  { key: 'customer_province', label: 'Province', type: 'text', required: false, builtin: true },
]

export const DEFAULT_LEAD_CTA = 'Fill my order'

export function builtinLeadField(key: string): LeadField | null {
  const found = BUILTIN_LEAD_FIELDS.find((field) => field.key === key)
  return found ? { ...found } : null
}

export function leadFieldKey(label: string): string {
  const slug = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 40)
  if (!slug) return ''
  return slug.startsWith('customer_') ? slug : `customer_${slug}`
}

export function customLeadField(label: string, type: LeadFieldType = 'text'): LeadField | null {
  const clean = String(label || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const key = leadFieldKey(clean)
  if (!clean || !key) return null
  const builtin = builtinLeadField(key)
  if (builtin) return builtin
  return { key, label: clean, type, required: false, builtin: false }
}

export function defaultLeadFields(): LeadField[] {
  return ['customer_name', 'customer_address', 'customer_city'].map((key) => builtinLeadField(key)!)
}

export function defaultLeadForm(enabled = false): LeadFormConfig {
  return {
    enabled,
    fields: defaultLeadFields(),
    cta: DEFAULT_LEAD_CTA,
    flowId: null,
    flowHash: null,
    flowStatus: 'none',
    flowError: null,
  }
}

function parseField(raw: unknown): LeadField | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  if (!key) return label ? customLeadField(label) : null
  const builtin = builtinLeadField(key)
  const type: LeadFieldType = record.type === 'phone' || record.type === 'textarea' || record.type === 'text'
    ? record.type
    : builtin?.type || 'text'
  return {
    key,
    label: label || builtin?.label || key,
    type,
    required: typeof record.required === 'boolean' ? record.required : builtin?.required ?? false,
    builtin: !!builtin,
  }
}

export function parseLeadForm(raw: unknown, fallbackEnabled = false): LeadFormConfig {
  const base = defaultLeadForm(fallbackEnabled)
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const seen = new Set<string>()
  const fields: LeadField[] = []
  if (Array.isArray(record.fields)) {
    for (const item of record.fields) {
      const field = parseField(item)
      if (!field || seen.has(field.key)) continue
      seen.add(field.key)
      fields.push(field)
    }
  }
  const status = record.flowStatus
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : base.enabled,
    fields: Array.isArray(record.fields) ? fields : base.fields,
    cta: typeof record.cta === 'string' && record.cta.trim() ? record.cta.trim().slice(0, 20) : base.cta,
    flowId: typeof record.flowId === 'string' && record.flowId.trim() ? record.flowId.trim() : null,
    flowHash: typeof record.flowHash === 'string' && record.flowHash.trim() ? record.flowHash : null,
    flowStatus: status === 'published' || status === 'unavailable' || status === 'error' ? status : 'none',
    flowError: typeof record.flowError === 'string' && record.flowError.trim() ? record.flowError.slice(0, 300) : null,
  }
}

/** Fields the AI must collect in chat (phone comes from WhatsApp). */
export function leadFieldsToCollect(form: LeadFormConfig): LeadField[] {
  return form.fields.filter((field) => field.key !== 'customer_phone')
}

export function leadFieldLabels(form: LeadFormConfig): string {
  return leadFieldsToCollect(form).map((field) => field.label).join(', ')
}

/** Stable fingerprint of the parts that change the published Flow. */
export function leadFormHash(form: LeadFormConfig): string {
  const payload = JSON.stringify({
    cta: form.cta,
    fields: form.fields.map((field) => [field.key, field.label, field.type, field.required]),
  })
  let hash = 0
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0
  }
  return `${LEAD_FLOW_VERSION}:${(hash >>> 0).toString(16)}`
}

/** True when the Flow published for this agent matches the current form. */
export function leadFlowReady(form: LeadFormConfig): boolean {
  return form.enabled && form.flowStatus === 'published' && !!form.flowId && form.flowHash === leadFormHash(form) && form.fields.length > 0
}

/** WhatsApp Flow JSON for the configured fields (single terminal screen). */
export function buildLeadFlowJson(form: LeadFormConfig, opts: { title?: string } = {}) {
  const children: Record<string, unknown>[] = form.fields.map((field) => {
    if (field.type === 'textarea') {
      return {
        type: 'TextArea',
        name: field.key,
        label: field.label,
        required: field.required,
        'max-length': 300,
      }
    }
    return {
      type: 'TextInput',
      name: field.key,
      label: field.label,
      required: field.required,
      'input-type': field.type === 'phone' ? 'phone' : 'text',
      'max-chars': field.type === 'phone' ? 20 : 80,
    }
  })
  const payload: Record<string, string> = {}
  for (const field of form.fields) payload[field.key] = `\${form.${field.key}}`
  children.push({
    type: 'Footer',
    label: form.cta.slice(0, 20),
    'on-click-action': {
      name: 'complete',
      payload,
    },
  })
  return {
    version: LEAD_FLOW_VERSION,
    screens: [
      {
        id: LEAD_FLOW_SCREEN,
        title: (opts.title || 'Your order').slice(0, 30),
        terminal: true,
        success: true,
        data: {},
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Form',
              name: 'order_form',
              children,
            },
          ],
        },
      },
    ],
  }
}

export function leadFlowToken(agentId: string, phone: string): string {
  return `qunvert:${agentId}:${phone.replace(/[^\d+]/g, '')}:${Date.now().toString(36)}`
}

export function parseLeadFlowToken(token: string): { agentId: string; phone: string } | null {
  const parts = String(token || '').split(':')
  if (parts.length < 4 || parts[0] !== 'qunvert') return null
  return { agentId: parts[1], phone: parts[2] }
}

/** Map a submitted Flow response (or chat-collected data) to order_data keys. */
export function leadResponseToOrderData(form: LeadFormConfig, response: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of form.fields) {
    const value = response[field.key] ?? response[field.label] ?? response[field.label.toLowerCase()]
    const text = value == null ? '' : String(value).trim()
    if (text) out[field.key] = text
  }
  return out
}

/** Custom (non-builtin) values as `Label: value` lines for the order note. */
export function leadCustomFieldLines(form: LeadFormConfig, orderData: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const field of form.fields) {
    if (field.builtin) continue
    const value = orderData[field.key]
    if (value == null || String(value).trim() === '') continue
    lines.push(`${field.label}: ${String(value).trim()}`)
  }
  return lines
}

export function missingRequiredLeadFields(form: LeadFormConfig, orderData: Record<string, unknown>): LeadField[] {
  return leadFieldsToCollect(form).filter((field) => field.required && !String(orderData[field.key] ?? '').trim())
}
