/**
 * WhatsApp Flow delivery for the lead agent order form.
 *
 * Everything goes through the FlashManager app-gateway. Today the gateway
 * exposes `/v1/whatsapp/send` for text/media only; the Flow routes used here
 * (`/v1/whatsapp/flows`) are the contract FlashManager needs to add. Until
 * then `ensureLeadFlow` reports `unavailable` and the runtime collects the
 * same fields in chat, so nothing breaks for sellers.
 */
import { gwResult } from './fm'
import {
  buildLeadFlowJson,
  leadFlowToken,
  leadFormHash,
  LEAD_FLOW_SCREEN,
  parseLeadFlowToken,
  type LeadFormConfig,
} from './leadForm'
import type { ThreadMessage } from './wa'

export type EnsureLeadFlowResult = Pick<LeadFormConfig, 'flowId' | 'flowHash' | 'flowStatus' | 'flowError'>

function pickFlowId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, any>
  const candidates = [
    record.flowId,
    record.flow_id,
    record.id,
    record.flow?.id,
    record.flow?.flow_id,
    record.data?.id,
    record.data?.flow_id,
  ]
  for (const value of candidates) {
    const id = String(value || '').trim()
    if (id) return id
  }
  return null
}

function errorText(status: number, data: unknown, text: string): string {
  const record = data && typeof data === 'object' ? (data as Record<string, any>) : null
  const message = record?.error?.message || record?.error || record?.message || text
  return `${status}: ${String(message || 'flow_failed').slice(0, 200)}`
}

/**
 * Create/publish (or update) the Flow that matches the current form. Returns
 * the fields to persist in `config.leadForm`. Never throws.
 */
export async function ensureLeadFlow(
  token: string,
  opts: { agentId: string; agentName: string; form: LeadFormConfig },
): Promise<EnsureLeadFlowResult> {
  const hash = leadFormHash(opts.form)
  if (!opts.form.enabled || !opts.form.fields.length) {
    return { flowId: opts.form.flowId, flowHash: opts.form.flowHash, flowStatus: opts.form.flowStatus === 'published' ? 'published' : 'none', flowError: null }
  }
  if (opts.form.flowStatus === 'published' && opts.form.flowId && opts.form.flowHash === hash) {
    return { flowId: opts.form.flowId, flowHash: hash, flowStatus: 'published', flowError: null }
  }
  const body = JSON.stringify({
    name: `qunvert-order-${opts.agentId}`.slice(0, 200),
    categories: ['LEAD_GENERATION'],
    flow_json: buildLeadFlowJson(opts.form, { title: 'Your order' }),
    publish: true,
    external_id: opts.agentId,
    flow_id: opts.form.flowId || undefined,
  })
  try {
    const result = await gwResult('/v1/whatsapp/flows', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (result.status === 404 || result.status === 405 || result.status === 501) {
      return { flowId: opts.form.flowId, flowHash: null, flowStatus: 'unavailable', flowError: 'FlashManager gateway has no WhatsApp Flows route yet.' }
    }
    if (!result.ok) {
      return { flowId: opts.form.flowId, flowHash: null, flowStatus: 'error', flowError: errorText(result.status, result.data, result.text) }
    }
    const flowId = pickFlowId(result.data)
    if (!flowId) {
      return { flowId: opts.form.flowId, flowHash: null, flowStatus: 'error', flowError: 'Gateway did not return a flow id.' }
    }
    return { flowId, flowHash: hash, flowStatus: 'published', flowError: null }
  } catch (error) {
    return {
      flowId: opts.form.flowId,
      flowHash: null,
      flowStatus: 'error',
      flowError: error instanceof Error ? error.message.slice(0, 200) : 'flow_failed',
    }
  }
}

export type SendLeadFlowResult = { ok: boolean; error?: string; messageId?: string; flowToken: string }

/** Send the order form as an interactive Flow message (inside the 24h window). */
export async function sendLeadFlow(
  token: string,
  opts: { to: string; agentId: string; form: LeadFormConfig; body: string },
): Promise<SendLeadFlowResult> {
  const flowToken = leadFlowToken(opts.agentId, opts.to)
  if (!opts.form.flowId) return { ok: false, error: 'flow_not_published', flowToken }
  if (!opts.body.trim()) return { ok: false, error: 'flow_message_required', flowToken }
  const payload = {
    to: opts.to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: opts.body.trim().slice(0, 1024) },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: opts.form.flowId,
          flow_cta: opts.form.cta.slice(0, 20),
          flow_action: 'navigate',
          flow_action_payload: { screen: LEAD_FLOW_SCREEN },
        },
      },
    },
  }
  try {
    const result = await gwResult('/v1/whatsapp/send', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = result.data && typeof result.data === 'object' ? (result.data as Record<string, any>) : {}
    if (result.ok && data.success !== false) {
      return { ok: true, messageId: data.messageId || data.message_id, flowToken }
    }
    return { ok: false, error: errorText(result.status, result.data, result.text), flowToken }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'send_failed', flowToken }
  }
}

export type LeadFlowReply = {
  values: Record<string, string>
  flowToken: string | null
  agentId: string | null
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Detect a Flow submission in an inbound thread message. The gateway stores
 * webhooks with different shapes depending on version, so we look in every
 * place Meta's `interactive.nfm_reply.response_json` could have landed.
 */
export function parseLeadFlowReply(message: ThreadMessage): LeadFlowReply | null {
  const meta = (message.metadata && typeof message.metadata === 'object' ? message.metadata : {}) as Record<string, any>
  const type = String(message.type || meta.message_type || meta.type || '').toLowerCase()
  const nfm = meta.nfm_reply || meta.interactive?.nfm_reply || meta.raw?.interactive?.nfm_reply || null
  const interactiveType = String(meta.interactive?.type || meta.interactive_type || '').toLowerCase()
  const candidates = [
    nfm?.response_json,
    meta.response_json,
    meta.flow_response,
    meta.flowResponse,
    type === 'interactive' || interactiveType === 'nfm_reply' ? message.body : null,
  ]
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate)
    if (!parsed) continue
    const flowToken = typeof parsed.flow_token === 'string' ? parsed.flow_token : null
    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'flow_token') continue
      if (value == null || typeof value === 'object') continue
      const text = String(value).trim()
      if (text) values[key] = text
    }
    if (!flowToken && !Object.keys(values).length) continue
    // Only trust payloads that came from a Qunvert flow, or that arrived as a real nfm_reply.
    const token = flowToken ? parseLeadFlowToken(flowToken) : null
    if (!token && !nfm && interactiveType !== 'nfm_reply') continue
    return { values, flowToken, agentId: token?.agentId || null }
  }
  return null
}
