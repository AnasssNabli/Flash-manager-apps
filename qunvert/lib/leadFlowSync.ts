import type { Agent } from '@prisma/client'
import { LEAD_GENERATION_AVAILABLE, parseAgentConfig } from './agentConfig'
import { prisma } from './db'
import { ensureLeadFlow } from './leadFlow'

/**
 * After an agent is created/updated: publish (or refresh) the WhatsApp Flow
 * for its lead form and persist the resulting status in `policiesJson`.
 * Never throws — a Flow problem must not block saving the agent.
 */
export async function publishLeadFlowForAgent(token: string, agent: Agent): Promise<Agent> {
  if (!LEAD_GENERATION_AVAILABLE) return agent
  const config = parseAgentConfig(agent.policiesJson)
  if (!config.leadForm.enabled || !config.leadForm.fields.length) return agent

  const result = await ensureLeadFlow(token, {
    agentId: agent.id,
    agentName: agent.name,
    form: config.leadForm,
  })
  const unchanged =
    result.flowId === config.leadForm.flowId &&
    result.flowHash === config.leadForm.flowHash &&
    result.flowStatus === config.leadForm.flowStatus &&
    result.flowError === config.leadForm.flowError
  if (unchanged) return agent

  let raw: Record<string, unknown> = {}
  try {
    raw = agent.policiesJson ? JSON.parse(agent.policiesJson) : {}
  } catch {
    raw = {}
  }
  const rawLead = raw.leadForm && typeof raw.leadForm === 'object' ? (raw.leadForm as Record<string, unknown>) : {}
  const policiesJson = JSON.stringify({
    ...raw,
    leadForm: { ...rawLead, ...result },
  })
  try {
    return await prisma.agent.update({ where: { id: agent.id }, data: { policiesJson } })
  } catch (error) {
    console.error('[wa-ai] lead flow status persist failed', error)
    return agent
  }
}
